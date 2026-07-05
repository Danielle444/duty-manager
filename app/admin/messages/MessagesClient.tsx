"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import {
  archiveMessageTask,
  createMessageTask,
  getMessageTaskRecipients,
  listMessageTasksForAdmin,
  updateMessageTask,
  type MessageAudienceValue,
  type MessageTaskListItem,
  type MessageTaskRecipientRow,
  type MessageTaskTypeValue,
} from "@/lib/actions/messages";
import { formatHebrewDateTime } from "@/lib/dates";

interface StudentOption {
  id: string;
  fullName: string;
  groupName: string | null;
}

const TYPE_LABELS: Record<MessageTaskTypeValue, string> = {
  MESSAGE: "הודעה",
  TASK: "משימה",
};

const AUDIENCE_LABELS: Record<MessageAudienceValue, string> = {
  ALL: "כל התלמידים הפעילים",
  GROUP: "קבוצה",
  SPECIFIC: "תלמידים ספציפיים",
};

function audienceSummary(item: MessageTaskListItem): string {
  if (item.audience === "GROUP") return `קבוצה ${item.groupName ?? "-"}`;
  return AUDIENCE_LABELS[item.audience];
}

export function MessagesClient({
  messageTasks,
  students,
  groups,
}: {
  messageTasks: MessageTaskListItem[];
  students: StudentOption[];
  groups: string[];
}) {
  const [items, setItems] = useState(messageTasks);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [type, setType] = useState<MessageTaskTypeValue>("MESSAGE");
  const [audience, setAudience] = useState<MessageAudienceValue>("ALL");
  const [groupName, setGroupName] = useState(groups[0] ?? "");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [drillDownTask, setDrillDownTask] = useState<MessageTaskListItem | null>(null);
  const [recipients, setRecipients] = useState<MessageTaskRecipientRow[] | null>(null);

  const [showArchived, setShowArchived] = useState(false);

  const [editTask, setEditTask] = useState<MessageTaskListItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditPending, startEditTransition] = useTransition();

  const [deleteTarget, setDeleteTarget] = useState<MessageTaskListItem | null>(null);
  const [isDeletePending, startDeleteTransition] = useTransition();

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.fullName.toLowerCase().includes(q));
  }, [students, studentSearch]);

  async function refreshList(includeArchived: boolean) {
    const fresh = await listMessageTasksForAdmin(includeArchived);
    setItems(fresh);
  }

  function toggleShowArchived() {
    const next = !showArchived;
    setShowArchived(next);
    refreshList(next);
  }

  function openCreate() {
    setType("MESSAGE");
    setAudience("ALL");
    setGroupName(groups[0] ?? "");
    setSelectedStudentIds([]);
    setStudentSearch("");
    setTitle("");
    setBody("");
    setError(null);
    setIsCreateOpen(true);
  }

  function toggleStudent(id: string) {
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createMessageTask({
        type,
        title,
        body,
        audience,
        groupName: audience === "GROUP" ? groupName : undefined,
        studentIds: audience === "SPECIFIC" ? selectedStudentIds : undefined,
      });
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      await refreshList(showArchived);
      setIsCreateOpen(false);
    });
  }

  function openDrillDown(task: MessageTaskListItem) {
    setDrillDownTask(task);
    setRecipients(null);
    getMessageTaskRecipients(task.id).then(setRecipients);
  }

  function openEdit(task: MessageTaskListItem) {
    setEditTask(task);
    setEditTitle(task.title);
    setEditBody(task.body);
    setEditError(null);
  }

  function handleEditSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editTask) return;
    setEditError(null);
    const taskId = editTask.id;
    startEditTransition(async () => {
      const result = await updateMessageTask(taskId, { title: editTitle, body: editBody });
      if (!result.success) {
        setEditError(result.error ?? "אירעה שגיאה");
        return;
      }
      await refreshList(showArchived);
      setEditTask(null);
    });
  }

  function handleConfirmArchive() {
    if (!deleteTarget) return;
    const taskId = deleteTarget.id;
    startDeleteTransition(async () => {
      await archiveMessageTask(taskId, true);
      await refreshList(showArchived);
      setDeleteTarget(null);
    });
  }

  function handleRestore(task: MessageTaskListItem) {
    startDeleteTransition(async () => {
      await archiveMessageTask(task.id, false);
      await refreshList(showArchived);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button onClick={openCreate}>+ יצירת הודעה/משימה</Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={toggleShowArchived} />
          הצג מחוקים/מוסתרים
        </label>
      </div>

      <div className="flex flex-col gap-3">
        {items.length === 0 && (
          <p className="rounded-xl border border-border bg-card p-5 text-center text-muted-foreground">
            עדיין לא נשלחו הודעות או משימות
          </p>
        )}
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    item.type === "TASK"
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-success-muted text-success"
                  }`}
                >
                  {TYPE_LABELS[item.type]}
                </span>
                {item.isArchived && (
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    בארכיון
                  </span>
                )}
                <p className="text-base font-bold text-card-foreground">{item.title}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatHebrewDateTime(new Date(item.createdAt))}
              </p>
            </div>
            <p className="mb-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                {audienceSummary(item)}
                {item.createdByName && ` · ${item.createdByName}`}
              </span>
              <div className="flex flex-wrap items-center gap-3">
                {item.type === "MESSAGE" ? (
                  <span className="text-muted-foreground">
                    נקראו {item.readCount}/{item.totalCount}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    הושלמו {item.completedCount}/{item.totalCount}
                  </span>
                )}
                <Button variant="ghost" className="!px-2 !py-1" onClick={() => openDrillDown(item)}>
                  צפייה בסטטוס
                </Button>
                <Button variant="ghost" className="!px-2 !py-1" onClick={() => openEdit(item)}>
                  עריכה
                </Button>
                {item.isArchived ? (
                  <Button
                    variant="secondary"
                    className="!px-2 !py-1"
                    disabled={isDeletePending}
                    onClick={() => handleRestore(item)}
                  >
                    שחזור
                  </Button>
                ) : (
                  <Button
                    variant="danger"
                    className="!px-2 !py-1"
                    onClick={() => setDeleteTarget(item)}
                  >
                    מחיקה
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal open={isCreateOpen} title="יצירת הודעה/משימה" onClose={() => setIsCreateOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="type"
                checked={type === "MESSAGE"}
                onChange={() => setType("MESSAGE")}
              />
              הודעה
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="type"
                checked={type === "TASK"}
                onChange={() => setType("TASK")}
              />
              משימה
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            כותרת
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            תוכן
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>

          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium text-card-foreground">נמענים</p>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                checked={audience === "ALL"}
                onChange={() => setAudience("ALL")}
              />
              כל התלמידים הפעילים
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                checked={audience === "GROUP"}
                onChange={() => setAudience("GROUP")}
              />
              קבוצה
            </label>
            {audience === "GROUP" && (
              <select
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              >
                {groups.length === 0 && <option value="">אין קבוצות זמינות</option>}
                {groups.map((g) => (
                  <option key={g} value={g}>
                    קבוצה {g}
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                checked={audience === "SPECIFIC"}
                onChange={() => setAudience("SPECIFIC")}
              />
              תלמידים ספציפיים
            </label>
            {audience === "SPECIFIC" && (
              <div className="flex flex-col gap-2">
                <input
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="חיפוש לפי שם..."
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                />
                <p className="text-xs text-muted-foreground">נבחרו {selectedStudentIds.length}</p>
                <div className="max-h-60 overflow-y-auto rounded-lg border border-border">
                  {filteredStudents.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">לא נמצאו תלמידים</p>
                  ) : (
                    filteredStudents.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-0"
                      >
                        <input
                          type="checkbox"
                          checked={selectedStudentIds.includes(s.id)}
                          onChange={() => toggleStudent(s.id)}
                        />
                        {s.fullName}
                        {s.groupName && (
                          <span className="text-xs text-muted-foreground">קבוצה {s.groupName}</span>
                        )}
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setIsCreateOpen(false)}>
              ביטול
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "שולח..." : "שליחה"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={drillDownTask !== null}
        title={drillDownTask ? `סטטוס - ${drillDownTask.title}` : ""}
        onClose={() => setDrillDownTask(null)}
      >
        {recipients === null ? (
          <p className="text-sm text-muted-foreground">טוען...</p>
        ) : recipients.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין נמענים</p>
        ) : (
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {recipients.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-0"
              >
                <span className="text-card-foreground">{r.studentFullName}</span>
                {drillDownTask?.type === "TASK" ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.completedAt
                        ? "bg-success-muted text-success"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {r.completedAt ? "הושלמה" : "פתוחה"}
                  </span>
                ) : (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.readAt ? "bg-success-muted text-success" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {r.readAt ? "נקראה" : "לא נקראה"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={editTask !== null}
        title={editTask ? `עריכת ${TYPE_LABELS[editTask.type]}` : ""}
        onClose={() => setEditTask(null)}
      >
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            כותרת
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            תוכן
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={4}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>
          {editError && <p className="text-sm text-danger">{editError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditTask(null)}>
              ביטול
            </Button>
            <Button type="submit" disabled={isEditPending}>
              {isEditPending ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        title="מחיקת הודעה/משימה"
        onClose={() => setDeleteTarget(null)}
      >
        <p className="text-sm text-card-foreground">
          האם למחוק/להסתיר את ההודעה/משימה &quot;{deleteTarget?.title}&quot;? הפעולה ניתנת לשחזור.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>
            ביטול
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={isDeletePending}
            onClick={handleConfirmArchive}
          >
            {isDeletePending ? "מוחק..." : "מחיקה"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
