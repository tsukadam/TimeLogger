package com.timelogger.wear.api

data class Folder(
    val id: String,
    val name: String,
    val color: String,
    val sortOrder: Int,
)

data class Task(
    val id: String,
    val folderId: String,
    val name: String,
    val color: String,
    val sortOrder: Int,
)

data class Event(
    val id: String,
    val taskId: String,
    val folderId: String,
    val taskName: String,
    val folderName: String,
    val taskColor: String,
    val folderColor: String,
    val startedAt: String,
    val endedAt: String?,
)

data class NowResult(
    val current: Event?,
    val last: Event?,
    val tasksUpdatedAt: String,
)

data class TasksFile(
    val folders: List<Folder>,
    val tasks: List<Task>,
    val updatedAt: String,
)

data class CommandWrite(
    val current: Event?,
    val last: Event?,
    val tasksUpdatedAt: String,
    val skipped: List<SkippedStop> = emptyList(),
)

data class SkippedStop(
    val eventId: String,
    val at: String,
)

data class QueueOp(
    val op: String,
    val at: String,
    val eventId: String,
    val taskId: String? = null,
    val startedAt: String? = null,
    val endedAt: String? = null,
)

data class PendingResume(
    val stopEventId: String,
    val at: String,
    val resumeTaskId: String,
)

class ApiException(val status: Int, message: String) : Exception(message)
