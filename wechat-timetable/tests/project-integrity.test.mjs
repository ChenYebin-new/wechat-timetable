import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const miniprogramRoot = join(projectRoot, 'miniprogram')
const bundleExtensions = ['.ts', '.json', '.wxml', '.wxss']

function walkFiles(root) {
  const files = []
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    if (statSync(path).isDirectory()) files.push(...walkFiles(path))
    else files.push(path)
  }
  return files
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    assert.fail(`${relative(projectRoot, path)} 不是有效 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
}

function assertBundle(basePath, label) {
  for (const extension of bundleExtensions) {
    assert.ok(existsSync(`${basePath}${extension}`), `${label} 缺少 ${extension} 文件`)
  }
}

function resolveLocalComponent(configPath, componentPath) {
  if (componentPath.startsWith('/')) return resolve(miniprogramRoot, componentPath.slice(1))
  if (componentPath.startsWith('.')) return resolve(dirname(configPath), componentPath)
  return null
}

function scanWxmlTags(markup, file) {
  const stack = []
  let cursor = 0
  while (cursor < markup.length) {
    const start = markup.indexOf('<', cursor)
    if (start < 0) break
    if (markup.startsWith('<!--', start)) {
      const commentEnd = markup.indexOf('-->', start + 4)
      assert.notEqual(commentEnd, -1, `${file} 存在未闭合注释`)
      cursor = commentEnd + 3
      continue
    }

    let quote = ''
    let end = start + 1
    for (; end < markup.length; end += 1) {
      const character = markup[end]
      if (quote) {
        if (character === quote && markup[end - 1] !== '\\') quote = ''
      } else if (character === '"' || character === "'") {
        quote = character
      } else if (character === '>') {
        break
      }
    }
    assert.ok(end < markup.length, `${file} 存在未闭合标签`)

    const body = markup.slice(start + 1, end).trim()
    cursor = end + 1
    if (!body || body.startsWith('!') || body.startsWith('?')) continue

    const closing = body.startsWith('/')
    const content = closing ? body.slice(1).trimStart() : body
    const name = content.match(/^([A-Za-z][\w-]*)/)?.[1]
    assert.ok(name, `${file} 存在无法识别的标签：<${body}>`)
    if (closing) {
      const opened = stack.pop()
      assert.equal(name, opened, `${file} 标签闭合顺序错误：期望 </${opened}>，实际 </${name}>`)
    } else if (!/\/\s*$/.test(body)) {
      stack.push(name)
    }
  }
  assert.deepEqual(stack, [], `${file} 存在未闭合标签：${stack.join(', ')}`)
}

function scanWxssBraces(stylesheet, file) {
  let depth = 0
  let quote = ''
  let inComment = false
  for (let index = 0; index < stylesheet.length; index += 1) {
    const character = stylesheet[index]
    const next = stylesheet[index + 1]
    if (inComment) {
      if (character === '*' && next === '/') {
        inComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (character === quote && stylesheet[index - 1] !== '\\') quote = ''
      continue
    }
    if (character === '/' && next === '*') {
      inComment = true
      index += 1
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      assert.ok(depth >= 0, `${file} 存在多余的 }`)
    }
  }
  assert.equal(inComment, false, `${file} 存在未闭合注释`)
  assert.equal(quote, '', `${file} 存在未闭合字符串`)
  assert.equal(depth, 0, `${file} 的花括号不平衡`)
}

function propertyName(property) {
  const name = property.name
  if (!name) return ''
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return ''
}

function objectKeys(object) {
  return new Set(object.properties.map(propertyName).filter(Boolean))
}

function registeredHandlers(scriptPath, registrationName) {
  const source = ts.createSourceFile(
    scriptPath,
    readFileSync(scriptPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  let registration
  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === registrationName
      && node.arguments[0]
      && ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      registration = node.arguments[0]
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(registration, `${relative(projectRoot, scriptPath)} 未注册 ${registrationName}`)

  if (registrationName === 'Page') return objectKeys(registration)
  const methods = registration.properties.find((property) => propertyName(property) === 'methods')
  assert.ok(methods && ts.isPropertyAssignment(methods) && ts.isObjectLiteralExpression(methods.initializer), `${relative(projectRoot, scriptPath)} 缺少 Component.methods`)
  return objectKeys(methods.initializer)
}

test('项目清单中的页面与本地组件都具有完整文件并可解析 JSON', () => {
  const jsonFiles = [
    ...walkFiles(miniprogramRoot).filter((path) => extname(path) === '.json'),
    join(projectRoot, 'package.json'),
    join(projectRoot, 'package-lock.json'),
    join(projectRoot, 'project.config.json'),
    join(projectRoot, 'tsconfig.json'),
  ]
  const configs = new Map(jsonFiles.map((path) => [path, readJson(path)]))
  const appConfigPath = join(miniprogramRoot, 'app.json')
  const appConfig = configs.get(appConfigPath)
  assert.ok(Array.isArray(appConfig.pages) && appConfig.pages.length > 0, 'app.json.pages 必须是非空数组')
  assert.equal(new Set(appConfig.pages).size, appConfig.pages.length, 'app.json.pages 不能重复')

  for (const appFile of ['app.ts', 'app.json', 'app.wxss']) {
    assert.ok(existsSync(join(miniprogramRoot, appFile)), `小程序入口缺少 ${appFile}`)
  }

  const declaredPages = new Set(appConfig.pages.map((pagePath) => resolve(miniprogramRoot, pagePath)))
  for (const [index, basePath] of [...declaredPages].entries()) {
    assertBundle(basePath, `页面 ${appConfig.pages[index]}`)
  }
  const discoveredPages = new Set(
    walkFiles(join(miniprogramRoot, 'pages'))
      .filter((path) => path.endsWith(`${sep}index.ts`))
      .map((path) => path.slice(0, -extname(path).length)),
  )
  assert.deepEqual([...discoveredPages].sort(), [...declaredPages].sort(), 'pages 下存在未注册页面或 app.json 指向不存在页面')

  for (const tab of appConfig.tabBar?.list || []) {
    assert.ok(appConfig.pages.includes(tab.pagePath), `tabBar 页面未在 app.json.pages 注册：${tab.pagePath}`)
  }

  const referencedComponents = new Set()
  for (const [configPath, config] of configs) {
    for (const componentPath of Object.values(config.usingComponents || {})) {
      assert.equal(typeof componentPath, 'string', `${relative(projectRoot, configPath)} 的组件路径必须是字符串`)
      const basePath = resolveLocalComponent(configPath, componentPath)
      if (!basePath) continue
      assert.ok(basePath.startsWith(`${miniprogramRoot}${sep}`), `组件路径越出 miniprogram：${componentPath}`)
      assertBundle(basePath, `组件 ${componentPath}`)
      const componentConfig = readJson(`${basePath}.json`)
      assert.equal(componentConfig.component, true, `${componentPath}.json 必须声明 component: true`)
      referencedComponents.add(basePath)
    }
  }
  const discoveredComponents = new Set(
    walkFiles(join(miniprogramRoot, 'components'))
      .filter((path) => path.endsWith(`${sep}index.json`))
      .map((path) => path.slice(0, -extname(path).length)),
  )
  assert.deepEqual([...discoveredComponents].sort(), [...referencedComponents].sort(), 'components 下存在未引用组件或组件配置缺失')
})

test('Node 主版本与微信共享基础库都已显式固定', () => {
  const expectedNodeMajor = readFileSync(join(projectRoot, '.node-version'), 'utf8').trim()
  const packageConfig = readJson(join(projectRoot, 'package.json'))
  const projectConfig = readJson(join(projectRoot, 'project.config.json'))

  assert.equal(expectedNodeMajor, '24', '.node-version 应固定 Node.js 24')
  assert.equal(process.versions.node.split('.')[0], expectedNodeMajor, `当前 Node.js ${process.versions.node} 与 .node-version 不一致`)
  assert.equal(packageConfig.engines?.node, '>=24 <25', 'package.json#engines 应与 .node-version 保持一致')
  assert.match(projectConfig.libVersion, /^\d+\.\d+\.\d+$/, 'project.config.json 必须固定明确的微信基础库版本，不能使用 trial')
})

test('全部 WXML 标签正确闭合', () => {
  for (const path of walkFiles(miniprogramRoot).filter((file) => extname(file) === '.wxml')) {
    scanWxmlTags(readFileSync(path, 'utf8'), relative(projectRoot, path))
  }
})

test('全部 WXSS 的注释、字符串与花括号正确闭合', () => {
  for (const path of walkFiles(miniprogramRoot).filter((file) => extname(file) === '.wxss')) {
    scanWxssBraces(readFileSync(path, 'utf8'), relative(projectRoot, path))
  }
})

test('WXML 中的事件绑定都指向对应 Page 或 Component 处理器', () => {
  const bindingPattern = /(?:^|\s)(?:(?:capture-)?(?:bind|catch)|mut-bind)(?::?[A-Za-z][\w-]*)\s*=\s*(["'])([A-Za-z_$][\w$]*)\1/g
  for (const markupPath of walkFiles(miniprogramRoot).filter((file) => extname(file) === '.wxml')) {
    const markup = readFileSync(markupPath, 'utf8')
    const bindings = [...markup.matchAll(bindingPattern)].map((match) => match[2])
    if (bindings.length === 0) continue
    const scriptPath = markupPath.slice(0, -extname(markupPath).length) + '.ts'
    const registrationName = markupPath.includes(`${sep}components${sep}`) ? 'Component' : 'Page'
    const handlers = registeredHandlers(scriptPath, registrationName)
    for (const handler of bindings) {
      assert.ok(handlers.has(handler), `${relative(projectRoot, markupPath)} 绑定了不存在的处理器 ${handler}`)
    }
  }
})
