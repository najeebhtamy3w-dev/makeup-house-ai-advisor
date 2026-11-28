import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Stable engineering signature (debug channel). The keystore lives OUTSIDE the repo.
// Point to it with keystore.properties (git-ignored) or env vars VFL_KEYSTORE / VFL_KEYSTORE_PASSWORD / VFL_KEY_ALIAS / VFL_KEY_PASSWORD.
val signingProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun sp(key: String, env: String): String? = signingProps.getProperty(key) ?: System.getenv(env)
val engStoreFile = sp("storeFile", "VFL_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }

android {
    namespace = "com.makeuphouse.visualfinderlite"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.makeuphouse.visualfinderlite"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (engStoreFile != null) {
            create("engineering") {
                storeFile = engStoreFile
                storePassword = sp("storePassword", "VFL_KEYSTORE_PASSWORD")
                keyAlias = sp("keyAlias", "VFL_KEY_ALIAS")
                keyPassword = sp("keyPassword", "VFL_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            if (engStoreFile != null) signingConfig = signingConfigs.getByName("engineering")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
    testOptions {
        unitTests.isReturnDefaultValues = true
        unitTests.isIncludeAndroidResources = true
        unitTests.all { t ->
            // Live Yandex tests run only on demand: ./gradlew testDebugUnitTest -Pvfl.live=true -Pvfl.images=/path/to/jpgs
            t.systemProperty("vfl.live", project.findProperty("vfl.live") ?: "false")
            t.systemProperty("vfl.images", project.findProperty("vfl.images") ?: "")
            t.systemProperty("vfl.out", layout.buildDirectory.dir("vfl-evidence").get().asFile.absolutePath)
            t.systemProperty("robolectric.graphicsMode", "NATIVE")
            t.maxHeapSize = "2g"
        }
    }
    packaging { resources.excludes += setOf("META-INF/*.version", "META-INF/*.kotlin_module", "DebugProbesKt.bin") }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

base.archivesName.set("MAKEUP-HOUSE-VISUAL-FINDER-LITE-1.0.0")

dependencies {
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    testImplementation("org.robolectric:robolectric:4.18.1")
    testImplementation("androidx.test:core-ktx:1.7.0")
}
