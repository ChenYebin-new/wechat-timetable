/** 与 UTF-8 编码一致：合法代理对 4 字节，孤立代理项按替换字符计 3 字节。 */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (const character of text) {
    const point = character.codePointAt(0) as number
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point <= 0xffff ? 3 : 4
  }
  return bytes
}
