export async function captureSensitiveInput(
  read: () => Promise<string>,
  sensitiveValues: string[],
) {
  const value = await read();
  if (value) sensitiveValues.push(value);
  return value;
}
