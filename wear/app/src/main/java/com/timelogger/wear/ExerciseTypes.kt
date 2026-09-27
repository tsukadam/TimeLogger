package com.timelogger.wear

import java.text.Collator
import java.util.Locale

internal data class ExerciseTypeChoice(
    val id: String,
    val label: String,
)

internal object ExerciseTypes {
    val picker: List<ExerciseTypeChoice> by lazy {
        val collator = Collator.getInstance(Locale.JAPANESE)
        listOf(
            ExerciseTypeChoice("ALPINE_SKIING", "アルペンスキー"),
            ExerciseTypeChoice("BACKPACKING", "バックパッキング"),
            ExerciseTypeChoice("BACK_EXTENSION", "バックエクステンション"),
            ExerciseTypeChoice("BADMINTON", "バドミントン"),
            ExerciseTypeChoice("BARBELL_SHOULDER_PRESS", "バーベルショルダープレス"),
            ExerciseTypeChoice("BASEBALL", "野球"),
            ExerciseTypeChoice("BASKETBALL", "バスケットボール"),
            ExerciseTypeChoice("BENCH_PRESS", "ベンチプレス"),
            ExerciseTypeChoice("BIKING", "自転車"),
            ExerciseTypeChoice("BIKING_STATIONARY", "室内自転車"),
            ExerciseTypeChoice("BOOT_CAMP", "ブートキャンプ"),
            ExerciseTypeChoice("BOXING", "ボクシング"),
            ExerciseTypeChoice("BURPEE", "バーピー"),
            ExerciseTypeChoice("CALISTHENICS", "自重トレーニング"),
            ExerciseTypeChoice("CRICKET", "クリケット"),
            ExerciseTypeChoice("CROSS_COUNTRY_SKIING", "クロスカントリースキー"),
            ExerciseTypeChoice("CRUNCH", "クランチ"),
            ExerciseTypeChoice("DANCING", "ダンス"),
            ExerciseTypeChoice("DEADLIFT", "デッドリフト"),
            ExerciseTypeChoice("ELLIPTICAL", "エリプティカル"),
            ExerciseTypeChoice("EXERCISE_CLASS", "エクササイズクラス"),
            ExerciseTypeChoice("FENCING", "フェンシング"),
            ExerciseTypeChoice("FOOTBALL_AMERICAN", "アメフト"),
            ExerciseTypeChoice("FOOTBALL_AUSTRALIAN", "オーストラリアンフットボール"),
            ExerciseTypeChoice("FORWARD_TWIST", "フォワードツイスト"),
            ExerciseTypeChoice("FRISBEE_DISC", "フリスビー"),
            ExerciseTypeChoice("GOLF", "ゴルフ"),
            ExerciseTypeChoice("GUIDED_BREATHING", "ガイド呼吸"),
            ExerciseTypeChoice("GYMNASTICS", "体操"),
            ExerciseTypeChoice("HANDBALL", "ハンドボール"),
            ExerciseTypeChoice("HIGH_INTENSITY_INTERVAL_TRAINING", "HIIT"),
            ExerciseTypeChoice("HIKING", "ハイキング"),
            ExerciseTypeChoice("HORSE_RIDING", "乗馬"),
            ExerciseTypeChoice("ICE_HOCKEY", "アイスホッケー"),
            ExerciseTypeChoice("ICE_SKATING", "アイススケート"),
            ExerciseTypeChoice("INLINE_SKATING", "インラインスケート"),
            ExerciseTypeChoice("JUMPING_JACK", "ジャンピングジャック"),
            ExerciseTypeChoice("JUMP_ROPE", "縄跳び"),
            ExerciseTypeChoice("LAT_PULL_DOWN", "ラットプルダウン"),
            ExerciseTypeChoice("LUNGE", "ランジ"),
            ExerciseTypeChoice("MARTIAL_ARTS", "格闘技"),
            ExerciseTypeChoice("MEDITATION", "瞑想"),
            ExerciseTypeChoice("MOUNTAIN_BIKING", "マウンテンバイク"),
            ExerciseTypeChoice("ORIENTEERING", "オリエンテーリング"),
            ExerciseTypeChoice("PADDLING", "パドリング"),
            ExerciseTypeChoice("PARA_GLIDING", "パラグライダー"),
            ExerciseTypeChoice("PILATES", "ピラティス"),
            ExerciseTypeChoice("PLANK", "プランク"),
            ExerciseTypeChoice("RACQUETBALL", "ラケットボール"),
            ExerciseTypeChoice("ROCK_CLIMBING", "ロッククライミング"),
            ExerciseTypeChoice("ROLLER_HOCKEY", "ローラーホッケー"),
            ExerciseTypeChoice("ROLLER_SKATING", "ローラースケート"),
            ExerciseTypeChoice("ROWING", "ボート"),
            ExerciseTypeChoice("ROWING_MACHINE", "ローイングマシン"),
            ExerciseTypeChoice("RUGBY", "ラグビー"),
            ExerciseTypeChoice("RUNNING", "ランニング"),
            ExerciseTypeChoice("RUNNING_TREADMILL", "トレッドミル"),
            ExerciseTypeChoice("SAILING", "セーリング"),
            ExerciseTypeChoice("SCUBA_DIVING", "スクーバダイビング"),
            ExerciseTypeChoice("SKATING", "スケート"),
            ExerciseTypeChoice("SKIING", "スキー"),
            ExerciseTypeChoice("SNOWBOARDING", "スノーボード"),
            ExerciseTypeChoice("SNOWSHOEING", "スノーシュー"),
            ExerciseTypeChoice("SOCCER", "サッカー"),
            ExerciseTypeChoice("SOFTBALL", "ソフトボール"),
            ExerciseTypeChoice("SQUASH", "スカッシュ"),
            ExerciseTypeChoice("SQUAT", "スクワット"),
            ExerciseTypeChoice("STAIR_CLIMBING", "階段"),
            ExerciseTypeChoice("STAIR_CLIMBING_MACHINE", "ステアクライマー"),
            ExerciseTypeChoice("STRENGTH_TRAINING", "筋力トレーニング"),
            ExerciseTypeChoice("STRETCHING", "ストレッチ"),
            ExerciseTypeChoice("SURFING", "サーフィン"),
            ExerciseTypeChoice("SWIMMING_OPEN_WATER", "オープンウォータースイム"),
            ExerciseTypeChoice("SWIMMING_POOL", "プール泳"),
            ExerciseTypeChoice("TABLE_TENNIS", "卓球"),
            ExerciseTypeChoice("TENNIS", "テニス"),
            ExerciseTypeChoice("UPPER_TWIST", "アッパツイスト"),
            ExerciseTypeChoice("VOLLEYBALL", "バレーボール"),
            ExerciseTypeChoice("WALKING", "ウォーキング"),
            ExerciseTypeChoice("WATER_POLO", "水球"),
            ExerciseTypeChoice("WEIGHTLIFTING", "ウェイトリフティング"),
            ExerciseTypeChoice("WORKOUT", "ワークアウト"),
            ExerciseTypeChoice("YACHTING", "ヨット"),
            ExerciseTypeChoice("YOGA", "ヨガ"),
        ).sortedWith { a, b -> collator.compare(a.label, b.label) }
    }

    const val SLEEP_ID = "SLEEP"

    val sleep = ExerciseTypeChoice(SLEEP_ID, "睡眠")

    fun bindList(linkedId: String?): List<ExerciseTypeChoice> {
        val bound = when (linkedId) {
            null -> emptyList()
            SLEEP_ID -> listOf(sleep)
            else -> picker.filter { it.id == linkedId }
        }
        val unboundSleep = if (linkedId == SLEEP_ID) emptyList() else listOf(sleep)
        val unboundRest = picker.filter { it.id != linkedId }
        return bound + unboundSleep + unboundRest
    }
}
