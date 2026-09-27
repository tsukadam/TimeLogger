package com.timelogger.wear

import java.util.UUID

internal fun newWatchEventId(): String = UUID.randomUUID().toString() + "w"
