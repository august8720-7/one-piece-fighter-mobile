/** 逻辑帧率。所有帧数据以此为单位。 */
export const LOGIC_FPS = 60;
/** 每逻辑帧毫秒数（仅供渲染层的累加器使用，core 内部不用时间）。 */
export const LOGIC_STEP_MS = 1000 / LOGIC_FPS;

/** 定点数：1 像素 = 256 子像素。core 内所有位置、速度均为子像素整数。 */
export const SUBPIXEL = 256;
export const px = (pixels: number): number => Math.round(pixels * SUBPIXEL);

/** 逻辑分辨率（像素）。渲染层按整数倍放大。 */
export const VIEW_W = 480;
export const VIEW_H = 270;

/** 舞台（像素）。约 2.2 屏宽，左右为墙。 */
export const STAGE_LEFT = px(-528);
export const STAGE_RIGHT = px(528);
export const GROUND_Y = px(0); // 地面 y = 0，向上为负

/** 两人最大水平间距 = 屏宽 - 边距，超过则镜头两侧"拉住"。 */
export const MAX_SEPARATION = px(VIEW_W - 64);

/** 重力与跳跃（子像素 / 帧，子像素 / 帧²）。 */
export const GRAVITY = px(0.55);
export const MAX_FALL_SPEED = px(12);
