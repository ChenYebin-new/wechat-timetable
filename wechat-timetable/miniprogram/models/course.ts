// models/course.ts
// 课程及本地存储根数据的数据类型

/** 一门课程。day 使用 1=周一 … 7=周日；节次 1..9。 */
export interface Course {
  id: string;          // 唯一主键，如 `${Date.now()}-${随机后缀}`
  name: string;        // 课程名称（必填）
  day: number;         // 1=周一 … 7=周日
  startPeriod: number; // 开始节次，1..9
  endPeriod: number;   // 结束节次，1..9
  teacher?: string;    // 教师（可选）
  location?: string;   // 教室（可选）
  color: string;       // 主题色，来自预设色板
  createdAt: number;   // 创建时间戳
  updatedAt: number;   // 更新时间戳
}

/** 整个课表存在一个 Storage key 下的根对象结构。 */
export interface TimetableStorage {
  schemaVersion: number;
  courses: Course[];
}
