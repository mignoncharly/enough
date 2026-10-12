export function shouldKeepReminderForInteraction(input: {
  reminderVisible: boolean;
  reminderFocused: boolean;
  foregroundProcessId: number | undefined;
  appProcessId: number;
}): boolean {
  return (
    input.reminderVisible &&
    (input.reminderFocused || input.foregroundProcessId === input.appProcessId)
  );
}
