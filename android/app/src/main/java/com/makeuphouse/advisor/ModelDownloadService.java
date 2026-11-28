package com.makeuphouse.advisor;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import java.util.Locale;
import java.util.Objects;

/**
 * Foreground lifetime for one explicitly requested model transfer. It never starts or retries a download.
 * Call begin only from a foreground user action; the caller owns network work and partial-file recovery.
 * Cancellation callbacks must be nonblocking: signal/interrupt only, never delete a partial or join a worker.
 * Android may hide drawer notifications when POST_NOTIFICATIONS is denied; foreground lifetime is separate.
 */
public final class ModelDownloadService extends Service {
    private static final String CHANNEL = "model-downloads";
    private static final String START = "com.makeuphouse.advisor.model-download.START";
    private static final String PAUSE = "com.makeuphouse.advisor.model-download.PAUSE";
    private static final String OWNER = "owner";
    private static final int NOTIFICATION = 3201;
    private static final Object LOCK = new Object();
    private static long sequence;
    private static Owner owner;
    private static ModelDownloadService instance;

    private static final class Owner {
        final long token;
        final Runnable cancel;
        long downloaded, total, lastUpdate;
        Owner(long token, Runnable cancel) { this.token=token; this.cancel=cancel; }
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private long attachedOwner;
    private boolean promoted;

    /** Throws on rejected startup; it does not silently continue a background transfer. */
    public static void begin(Context context, Runnable ownerCancel) {
        Objects.requireNonNull(context, "context");
        Objects.requireNonNull(ownerCancel, "ownerCancel");
        Context app=context.getApplicationContext();
        final Owner next;
        synchronized(LOCK) {
            if(owner!=null)throw new IllegalStateException("MODEL_DOWNLOAD_SERVICE_BUSY");
            next=new Owner(++sequence,ownerCancel);
            owner=next;
        }
        Intent intent=new Intent(app,ModelDownloadService.class).setAction(START).putExtra(OWNER,next.token);
        try {
            if((Build.VERSION.SDK_INT>=26?app.startForegroundService(intent):app.startService(intent))==null)
                throw new IllegalStateException("MODEL_DOWNLOAD_SERVICE_UNAVAILABLE");
        } catch(RuntimeException error) {
            synchronized(LOCK) { if(owner==next)owner=null; }
            throw error;
        }
    }

    /** Completion detaches the callback BEFORE stopping; onDestroy cannot cancel completed work. */
    public static void end(Context context) {
        synchronized(LOCK) { owner=null; }
        context.getApplicationContext().stopService(new Intent(context.getApplicationContext(),ModelDownloadService.class));
    }

    /** True only after actual foreground promotion, not merely a queued start request. */
    public static boolean running() {
        synchronized(LOCK) { return owner!=null&&instance!=null&&instance.promoted&&instance.attachedOwner==owner.token; }
    }

    /** Byte accounting is supplied by the owning downloader; updates are bounded to one per second. */
    public static void progress(long downloaded,long total) {
        final ModelDownloadService service;
        final long token;
        synchronized(LOCK) {
            if(owner==null)return;
            owner.downloaded=Math.max(0,downloaded);owner.total=Math.max(0,total);
            long now=SystemClock.elapsedRealtime();
            if(owner.lastUpdate!=0&&now-owner.lastUpdate<1000&&!(total>0&&downloaded>=total))return;
            owner.lastUpdate=now;service=instance;token=owner.token;
        }
        if(service!=null)service.main.post(()->service.updateNotification(token));
    }

    @Override public void onCreate() {
        super.onCreate();
        synchronized(LOCK) { instance=this;attachedOwner=owner==null?0:owner.token; }
        try {
            NotificationManager manager=getSystemService(NotificationManager.class);
            if(Build.VERSION.SDK_INT>=26) {
                NotificationChannel channel=new NotificationChannel(CHANNEL,"تنزيل نماذج الذكاء المحلي",NotificationManager.IMPORTANCE_LOW);
                channel.setDescription("تقدم تنزيل النموذج وإيقافه مؤقتًا؛ الأجزاء المحفوظة تُستأنف من التطبيق.");
                manager.createNotificationChannel(channel);
            }
            Notification notification=notification();
            if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(NOTIFICATION,notification);
            synchronized(LOCK) { promoted=true; }
        } catch(RuntimeException error) {
            // Android startup/type/time-budget restrictions must stop the owning work, not crash or fall back silently.
            cancelAndStop(attachedOwner);
        }
    }

    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        if(intent==null) { cancelAndStop(attachedOwner);return START_NOT_STICKY; }
        long token=intent.getLongExtra(OWNER,0);
        if(PAUSE.equals(intent.getAction())) { cancelAndStop(token);return START_NOT_STICKY; }
        if(!START.equals(intent.getAction())) { cancelAndStop(attachedOwner);return START_NOT_STICKY; }
        boolean active;
        synchronized(LOCK) {
            active=owner!=null;
            if(active&&owner.token==token)attachedOwner=token;
            else if(active)return START_NOT_STICKY; // stale startup must not stop a newer owner
        }
        if(!active||!promoted)cancelAndStop(attachedOwner);
        else updateNotification(token);
        return START_NOT_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    /** API35 dataSync timeout: stop immediately and preserve resumable partial data through the owner's cancellation. */
    @Override public void onTimeout(int startId,int foregroundServiceType) { cancelAndStop(attachedOwner); }

    @Override public void onDestroy() {
        Runnable cancel=null;
        synchronized(LOCK) {
            if(instance==this)instance=null;
            promoted=false;
            if(owner!=null&&owner.token==attachedOwner) { cancel=owner.cancel;owner=null; }
        }
        main.removeCallbacksAndMessages(null);
        invokeCancel(cancel);
        super.onDestroy();
    }

    private void cancelAndStop(long token) {
        Runnable cancel=null;
        synchronized(LOCK) {
            if(owner!=null&&owner.token!=token)return; // an old Pause intent cannot cancel another transfer
            if(owner!=null) { cancel=owner.cancel;owner=null; }
            promoted=false;
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
        invokeCancel(cancel);
    }

    private static void invokeCancel(Runnable cancel) {
        if(cancel!=null)try { cancel.run(); } catch(RuntimeException ignored) { /* service teardown must finish */ }
    }

    private void updateNotification(long token) {
        synchronized(LOCK) { if(owner==null||owner.token!=token||instance!=this||!promoted)return; }
        try { getSystemService(NotificationManager.class).notify(NOTIFICATION,notification()); }
        catch(SecurityException ignored) { /* denied notification permission does not authorize claiming drawer visibility */ }
    }

    private Notification notification() {
        long token,downloaded,total;
        synchronized(LOCK) {
            token=owner==null?0:owner.token;downloaded=owner==null?0:owner.downloaded;total=owner==null?0:owner.total;
        }
        Intent pause=new Intent(this,ModelDownloadService.class).setAction(PAUSE).putExtra(OWNER,token);
        PendingIntent pauseAction=PendingIntent.getService(this,(int)(token&0x7fffffff),pause,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Intent open=getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent content=open==null?null:PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);
        String text=total>0?String.format(Locale.ROOT,"%.1f / %.1f ميجابايت",downloaded/1048576d,total/1048576d):"جارٍ تجهيز التنزيل؛ يمكن إيقافه مؤقتًا ثم استئنافه.";
        builder.setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("تنزيل نموذج الذكاء المحلي")
            .setContentText(text).setCategory(Notification.CATEGORY_SERVICE).setOngoing(true).setOnlyAlertOnce(true)
            .setShowWhen(false).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setProgress(100,total>0?(int)Math.min(100d,100d*downloaded/total):0,total<=0)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause,"إيقاف مؤقت",pauseAction).build());
        if(content!=null)builder.setContentIntent(content);
        if(Build.VERSION.SDK_INT>=31)builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return builder.build();
    }
}
