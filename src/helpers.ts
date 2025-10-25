export function generateId(): string {
  return `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function randomColor() {
  return `#${Math.floor(Math.random() * 16777215).toString(16)}`;
}
