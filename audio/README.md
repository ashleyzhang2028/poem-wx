# TTS 合成清单

给 `inclusionAI/Ming-3.0-tts-0.5b` 用的批量合成命令与音频文件名对照表，由
`node scripts/gen-audio-lines.js` 从 `scripts/corpus/` 生成。

| 文件 | 篇数 | 内容 |
| -- | -- | -- |
| `kenei_py.txt` / `kenei_map.md` | 251 | 课内诗词 |
| `tangshi300_py.txt` / `tangshi300_map.md` | 252 | 唐诗三百首，去掉与课内同篇 |
| `songci300_py.txt` / `songci300_map.md` | 240 | 宋词三百首，去掉与课内同篇 |
| `tongxinshihua_py.txt` / `tongxinshihua_map.md` | 129 | 童心诗话，去掉与课内同篇 |

`_py.txt` 每行一条 `python infer.py …`；`_map.md` 是同一批篇目的题名、朝代、作者与音频文件名
（扩展名按 mp3 写，TTS 直接出 wav 时先转码再上传）。

## 口径

- `--text`：题名、朝代、作者、正文，四段以单个空格分隔，正文内的换行与空格一律去掉。
- `--output`：`.\output\` 加「题名拼音_作者拼音.mp3」。题名里的括注（如「悯农（其二）」的「（其二）」）不进文件名；`ü` 写作 `v`。
- 同一篇出现在两部集子里（正文去标点后一致）时共用一个文件名，只合成一次；同名同作者而正文不同的，第二篇起加 `_2`、`_3`。
- 去重按正文比对，不比题名：《唐诗三百首》的「渭城曲」与课内的《送元二使安西》是同一首，只留课内那条。
- 多音字按词定音：`岑参` 读 cēn shēn、`汉乐府` 与词牌里的「乐」读 yuè、`清平调` 读 diào、`受降城` 读 xiáng、`给事` 读 jǐ。词表在 `scripts/gen-audio-lines.js`。

## 音频播放

四份 `_map.md` 是「篇目 → mp3」的唯一来源。`scripts/corpus-seed.js` 按题名 + 作者把它们绑到
篇目上，落成 `corpus_poems.audio` / `corpus_catalog.audio` 两列，经 `GET /api/corpus/poems` 与
`GET /api/corpus/catalogs` 下发；同一首正文在课内与集子里都出现时共用同一个文件，集子里没进清单的
那些篇目按正文对一次，对上就沿用课内那条。清单里有的文件才出播放键，没有的那篇不出。

`_map.md` 是待合成表，写上名字不等于云端有这个 mp3：真传了哪几首以云端 `audio/poem/` 为准，
播放器取不到文件时会提示「音频文件添加中」并跳过。要让播放键跟着实际文件走，把没传的那一行从
`_map.md` 里删掉，重跑生成器与 SQL（见仓库根 `docs/architecture.md` § 三）。

播放地址为 `https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/audio/poem/<文件名>`，
只在 `miniprogram/utils/poem-audio.js` 里拼一次。播放能力键 `audio`，Pro 起。

## 重新生成

```bash
node scripts/gen-audio-lines.js
```

语料变了就重跑，不要手改这几份文件。读音表里没有的字在 `scripts/gen-audio-lines.js` 的 `LETTERS` 里补；单字读不出音会直接报错，不会静默写成空。
