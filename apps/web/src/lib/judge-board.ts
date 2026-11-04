/** Shared demo board reserved for evaluator sessions — hidden from the operator fleet. */

export const JUDGE_BOARD_NAME = "orin";
export const JUDGE_BOARD_ID = "a6dd3900-0cf9-4bbb-b3d3-4b255f0b01bc";

export function isJudgeBoard(device: { id?: string | null; name?: string | null }): boolean {
  const name = (device.name || "").trim().toLowerCase();
  if (name === JUDGE_BOARD_NAME) return true;
  return Boolean(device.id && device.id === JUDGE_BOARD_ID);
}
