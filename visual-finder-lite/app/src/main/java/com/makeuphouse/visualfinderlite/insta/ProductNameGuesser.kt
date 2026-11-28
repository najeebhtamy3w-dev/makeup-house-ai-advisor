package com.makeuphouse.visualfinderlite.insta

import java.text.Normalizer

/**
 * Guesses "brand + product line" from the titles of Yandex similar-image results.
 * Idea: the brand/product words repeat across many independent shop titles (in any language),
 * while shop names, prices and generic words don't. Pure JVM; tested on live data of 12 products.
 */
object ProductNameGuesser {

    data class Guess(
        val phrase: String,              // best search phrase, e.g. "essence lash princess false"
        val brand: String,               // most frequent token, e.g. "essence"
        val suggestions: List<String>,   // phrase first, then alternatives (distinct)
        val support: Int,                // how many titles contain the brand
        val total: Int,
    )

    private val STOP = ("buy price prices sale sales online shop store cheap cheapest best new original review reviews " +
        "with for the and from free shipping delivery order wholesale retail discount discounted products product " +
        "pour les des aux une avec sur par dans mit und fur von der die das con per del della los las para por " +
        "en et de la le du au el il un una of to in on at by is it its ml mg pcs pack set size spf fps ean cm oz fl " +
        "ref sku art item cheaper than all www com net org ru amazon ebay ozon wildberries joom aliexpress market " +
        "marketplace noon jumia shein temu blog").split(' ').toSet()

    private val UNIT = Regex("""\d+(ml|g|gr|mg|oz|pcs)""")

    fun normalize(s: String): String {
        val d = Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("""\p{Mn}+"""), "")
        return d.lowercase().replace('’', '\'')
            .replace(Regex("""\b[cdjlmnst]'(?=\p{L})"""), "")   // French elisions: l'huile -> huile
            .replace("'s", " ").replace("'", "")
    }

    /** Latin tokens of a title; null marks a break (stop word / noise) so n-grams don't jump over it. */
    fun tokens(title: String): List<String?> =
        normalize(title).split(Regex("[^a-z0-9]+")).filter { it.isNotEmpty() }.map { w ->
            when {
                w.length < 3 -> null
                w.all(Char::isDigit) && w.length != 3 -> null // keep "540", drop "2024", "50"
                w in STOP || UNIT.matches(w) -> null
                else -> w
            }
        }

    fun guess(titles: List<String>): Guess? {
        val seqs = titles.map(::tokens)
        val df = HashMap<String, Int>()
        seqs.forEach { sq -> sq.filterNotNull().toSet().forEach { df[it] = (df[it] ?: 0) + 1 } }
        val brand = df.entries.filter { !it.key.all(Char::isDigit) }
            .maxWithOrNull(compareBy<Map.Entry<String, Int>>({ it.value }, { it.key.length }))?.key ?: return null

        val grams = HashMap<String, Int>()
        for (sq in seqs) {
            val seen = HashSet<String>()
            for (n in 2..4) for (i in 0..sq.size - n) {
                val g = sq.subList(i, i + n)
                if (g.any { it == null } || g.toSet().size < n) continue
                seen += g.joinToString(" ")
            }
            seen.forEach { grams[it] = (grams[it] ?: 0) + 1 }
        }
        val minCount = maxOf(3, Math.round(titles.size * 0.1).toInt())
        fun score(e: Map.Entry<String, Int>) = e.value * Math.pow(e.key.count { it == ' ' } + 1.0, 0.9)
        val frequent = grams.entries.filter { it.value >= minCount }
        val phrase = frequent.filter { brand in it.key.split(' ') }.maxByOrNull(::score)?.key ?: brand

        // "head" = what alternatives are built on: a 2-word phrase ("petit marseillais") beats a lone weak token.
        val phraseWords = phrase.split(' ')
        val head = if (phraseWords.size == 2) phrase else brand
        fun endsWithNumber(x: String) = x.substringAfterLast(' ').all(Char::isDigit)
        val out = LinkedHashSet<String>()
        out += phrase
        // product-line phrase without the brand, e.g. "lash princess", "lip lingerie xxl"
        frequent.filter { e -> e.key.split(' ').none { it in phraseWords } && !endsWithNumber(e.key) }
            .sortedByDescending(::score).take(2).forEach { out += "$head ${it.key}" }
        out += head
        df.entries.filter { !it.key.all(Char::isDigit) && it.key !in phraseWords && it.value >= minCount }
            .sortedByDescending { it.value }.take(3).forEach { out += "$head ${it.key}" }
        return Guess(phrase, brand, out.take(6), df[brand] ?: 0, titles.size)
    }
}
