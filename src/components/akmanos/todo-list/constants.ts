export type TodoItemStatus =
  | "pending"
  | "in-progress"
  | "completed"
  | "cancelled";

export type TodoItem = {
  id: string;
  title: string;
  status?: TodoItemStatus;
  progress?: number;
  detail?: string;
};

export const TODO_TASKS = [
  "Audit the Next.js production build and env checklist",
  "Provision the VPS and lock down SSH access",
  "Deploy the release, install deps, and start the Node process",
  "Configure Nginx, issue TLS, and verify health checks",
] as const;

export const TICKS_PER_TASK = 4;
export const TICK_MS = 280;
export const TODO_LIST_TITLE = "VPS deploy plan";
export const TODO_LIST_MAX_HEIGHT = 248;

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const SPRING_SWAP = {
  type: "spring" as const,
  stiffness: 460,
  damping: 30,
  mass: 0.55,
};

export const SPRING_LAYOUT = {
  type: "spring" as const,
  stiffness: 360,
  damping: 32,
  mass: 0.6,
};

export function itemsAtStep(step: number): TodoItem[] {
  return TODO_TASKS.map((title, index) => {
    const start = index * TICKS_PER_TASK;
    const end = (index + 1) * TICKS_PER_TASK;
    const inProgress = step >= start && step < end;

    return {
      id: `deploy-${index}`,
      title,
      status:
        step >= end
          ? "completed"
          : step >= start
            ? "in-progress"
            : "pending",
      progress: inProgress ? ((step % TICKS_PER_TASK) + 1) * 25 : undefined,
      detail: inProgress ? `${((step % TICKS_PER_TASK) + 1) * 25}%` : undefined,
    };
  });
}
