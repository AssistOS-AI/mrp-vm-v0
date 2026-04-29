import { listChatDemoTasks } from '../eval/reasoning-cases.mjs';

export async function loadDemoTasks(rootDir = process.cwd()) {
  void rootDir;
  return listChatDemoTasks()
    .map((entry) => ({
      order: Number(entry.order ?? 0),
      id: String(entry.id ?? '').trim(),
      title: String(entry.title ?? '').trim(),
      summary: String(entry.summary ?? '').trim(),
      reasoning_classes: Array.isArray(entry.reasoning_classes)
        ? entry.reasoning_classes.map((item) => String(item ?? '').trim()).filter(Boolean)
        : [],
      prompt: String(entry.prompt ?? ''),
    }))
    .filter((entry) => entry.id && entry.title && entry.prompt)
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      return left.id.localeCompare(right.id);
    });
}
