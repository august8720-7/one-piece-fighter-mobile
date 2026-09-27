import type { AnimTable } from '@render/animations';

/**
 * 逻辑回退配置：状态使用 DEFAULT_ANIMS，招式帧数由 MoveData.sprite 自动枚举。
 * 正式连续动作仍由根任务的已核验运行时清单提供；这里不伪报素材帧数。
 */
export const labubuAnims: AnimTable = {};
