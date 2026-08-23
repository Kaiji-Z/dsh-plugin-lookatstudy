/** Build the headless livetest fixture folder: a .docx (zip builder) + md + zh-CN translation + a tiny png. */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '.livetest-fixture', 'course-materials')
rmSync(root, { recursive: true, force: true })
mkdirSync(root, { recursive: true })
mkdirSync(join(root, 'translations', 'zh-CN'), { recursive: true })
mkdirSync(join(root, 'img'), { recursive: true })

const enc = new TextEncoder()

function concat(parts) {
  let total = 0
  for (const p of parts) total += p.length
  const res = new Uint8Array(total)
  let off = 0
  for (const p of parts) { res.set(p, off); off += p.length }
  return res
}

function buildZip(files) {
  const locals = [], centrals = [], offsets = [], payloads = []
  let offset = 0
  for (const f of files) {
    offsets.push(offset)
    const nameB = enc.encode(f.name)
    const payload = f.store ? f.data : new Uint8Array(deflateRawSync(f.data, { level: 6 }))
    payloads.push(payload)
    const lhdr = new Uint8Array(30 + nameB.length)
    const dv = new DataView(lhdr.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(8, f.store ? 0 : 8, true)
    dv.setUint32(18, payload.length, true)
    dv.setUint32(22, f.data.length, true)
    dv.setUint16(26, nameB.length, true)
    lhdr.set(nameB, 30)
    locals.push(lhdr, payload)
    offset += lhdr.length + payload.length
  }
  const cenStart = offset
  const all = files.map((f, i) => ({ name: f.name, store: f.store ?? false, uncomp: f.data.length, comp: payloads[i].length, off: offsets[i] }))
  for (const e of all) {
    const nameB = enc.encode(e.name)
    const cen = new Uint8Array(46 + nameB.length)
    const dv = new DataView(cen.buffer)
    dv.setUint32(0, 0x02014b50, true)
    dv.setUint16(10, e.store ? 0 : 8, true)
    dv.setUint32(20, e.comp, true)
    dv.setUint32(24, e.uncomp, true)
    dv.setUint16(28, nameB.length, true)
    dv.setUint32(42, e.off, true)
    cen.set(nameB, 46)
    centrals.push(cen)
  }
  const cenBytes = concat(centrals)
  const eocd = new Uint8Array(22)
  const edv = new DataView(eocd.buffer)
  edv.setUint32(0, 0x06054b50, true)
  edv.setUint16(8, all.length, true)
  edv.setUint16(10, all.length, true)
  edv.setUint32(12, cenBytes.length, true)
  edv.setUint32(16, cenStart, true)
  return concat([...locals, cenBytes, eocd])
}

const paras = [
  { style: 'Heading1', text: 'Chapter One Neural Networks' },
  { text: 'A neural network stacks layers of learned transformations. Each layer multiplies its input by a weight matrix and applies a nonlinear activation, letting simple units compose into arbitrary functions when stacked deep enough. Training adjusts the weights by gradient descent on a loss that measures the mismatch between predictions and targets.' },
  { style: 'Heading1', text: 'Chapter Two Backpropagation' },
  { text: 'Backpropagation computes gradients by applying the chain rule backwards through the network. Each layer receives the gradient of the loss with respect to its output and multiplies by the local Jacobian to obtain the gradient with respect to its input, reusing intermediate results so the whole pass costs about the same as a forward pass.' },
]
const body = paras.map(p => `<w:p>${p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${p.text}</w:t></w:r></w:p>`).join('')
writeFileSync(join(root, 'neural-notes.docx'), buildZip([
  { name: '[Content_Types].xml', data: enc.encode('<Types/>') },
  { name: 'word/document.xml', data: enc.encode(`<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`) },
]))

writeFileSync(join(root, 'optimizer-notes.md'), `# Optimizer Notes

## Momentum

Momentum accumulates a velocity from past gradients so the update keeps moving through small ravines instead of oscillating. The coefficient is usually 0.9.

## Adam

Adam keeps running means of the gradient and its square, rescaling the step per parameter. It converges fast with little tuning, which made it the default optimizer across deep learning. Diagram: ![loss curve](img/curve.png)
`)
writeFileSync(join(root, 'img', 'curve.png'), Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(40)]))
writeFileSync(join(root, 'translations', 'zh-CN', 'optimizer-notes.md'), `# 优化器笔记

## 动量

动量从历史梯度累积速度,让更新穿越狭长峡谷而非来回震荡,系数常取 0.9。

## Adam

Adam 维护梯度与梯度平方的滑动均值,按参数重标步长,几乎免调参即快速收敛。
`)
console.log('fixture at', root)
