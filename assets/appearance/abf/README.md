# A／B／F 外观素材

2026-09-29，按用户原六屏方案制作独立运行时素材。整页参考图不作为运行时背景；课程、文字、表单、按钮和列表均为真实 WXML/WXSS。

## 原始六屏参考图

本机生成记录目录标识：`generated_images/01a0e362-2d7a-7203-9823-1dd5856bc89d/`（不属于仓库路径）。

| 方案 | 课表／待办／月历 | 编辑／设置／备份 |
| --- | --- | --- |
| A 纸上拾课 | `exec-1f1c781c-b504-4595-9286-a2601928e548.png` | `exec-58661cd8-f5a3-411f-95db-f46692340e15.png` |
| B 秩序之间 | `exec-e9eeb78e-c85d-40aa-8105-76442b63001a.png` | `exec-6c12e256-e1b3-4940-95f7-b22be05baa19.png` |
| F 像素课间 | `exec-c1246a0e-59f8-4ca4-99b2-e2598e1ae754.png` | `exec-80c60a04-8170-4d54-961e-408780cdd7d3.png` |

## 新增运行时资源

- `paper-sprig.source.png`：图像生成工具绘制的透明水彩橄榄枝；运行时压缩为 160px 宽 PNG，用于 A 子页及待办章节。
- `paper-texture.source.png`：图像生成工具绘制的无物件米白纸纹；运行时 360px 宽 JPEG，并编码为 `themes/paper-texture.ts` 的本地 data URL，以兼容 WXSS 背景图片。
- `pixel-campus.source.png`：图像生成工具绘制的透明像素校园，黄墙、钴蓝轮廓、树木、云朵和空白书本；运行时 640px 宽 PNG。
- A／B／F 图标为代码绘制的轻量 SVG，存于 `miniprogram/assets/appearance/`。F 阶梯边框为 `themes/pixel-frame.ts` 中的九宫格 SVG，不依赖远程资源。

三个原始图像生成文件分别为 `exec-35f750ff-03f9-42e5-8559-d9460581b062.png`、`exec-bc42a262-f308-4e3b-8428-7107eca3b3c5.png`、`exec-a2121968-61d4-4a60-90d8-11c56790a9d9.png`；原文件已保留，不覆盖历史素材。

## 字体与验证边界

全部使用系统中文字体，无字体下载。A 优先 Songti SC、STSong、SimSun，缺失时由系统衬线字体回退；F 用粗体文字与像素几何建立风格，正文仍可选择、可读。不同设备的中文笔画和阶梯边框抗锯齿可能存在差异，以真机验收为准。实际页面对照与存储隔离结果见 `docs/主题系统验收记录.md`。
