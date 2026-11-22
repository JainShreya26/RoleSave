const namedLimit = 5;

/** Content for the delete dialog. Naming the roles makes a wrong tick easy to catch. */
export function deleteConfirmation(names: string[]) {
  const count = names.length;
  const singular = count === 1;

  return {
    confirmLabel: singular ? "Delete role" : `Delete ${count} roles`,
    description: singular
      ? "This permanently removes this role, including its timeline, actions, saved files, and PDFs."
      : "This permanently removes these roles, including their timelines, actions, saved files, and PDFs.",
    names: names.slice(0, namedLimit),
    remainingCount: Math.max(0, count - namedLimit),
    title: singular ? "Delete this role?" : `Delete ${count} roles?`,
  };
}
