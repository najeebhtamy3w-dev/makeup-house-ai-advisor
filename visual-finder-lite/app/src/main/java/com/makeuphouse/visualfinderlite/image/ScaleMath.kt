package com.makeuphouse.visualfinderlite.image

/** Pure sizing math for the search copy (unit tested). */
object ScaleMath {
    /** Longest side sent to Yandex. Large enough for label text, small enough for weak networks. */
    const val MAX_SIDE = 1600

    fun target(w: Int, h: Int, max: Int = MAX_SIDE): Pair<Int, Int> {
        require(w > 0 && h > 0) { "bad size" }
        val longest = maxOf(w, h)
        if (longest <= max) return w to h
        val s = max.toDouble() / longest
        return maxOf(1, Math.round(w * s).toInt()) to maxOf(1, Math.round(h * s).toInt())
    }
}
