# TTS 合成清单

给 `inclusionAI/Ming-3.0-tts-0.5b` 用的批量合成命令与音频文件名对照表，由
`node scripts/gen-audio-lines.js` 从 `scripts/corpus/` 生成。

| 文件 | 篇数 | 内容 |
| -- | -- | -- |
| `kenei_py.txt` / `kenei_map.md` | 251 | 课内诗词 |
| `tangshi300_py.txt` / `tangshi300_map.md` | 252 | 唐诗三百首，去掉与课内同篇 |
| `songci300_py.txt` / `songci300_map.md` | 240 | 宋词三百首，去掉与课内同篇 |
| `tongxinshihua_py.txt` / `tongxinshihua_map.md` | 129 | 童心诗话，去掉与课内同篇 |

`_py.txt` 每行一条 `python infer.py …`；`_map.md` 是同一批篇目的题名、朝代、作者与音频文件名。

## 口径

- `--text`：题名、朝代、作者、正文，四段以单个空格分隔，正文内的换行与空格一律去掉。
- `--output`：`.\output\` 加「题名拼音_作者拼音.wav」。题名里的括注（如「悯农（其二）」的「（其二）」）不进文件名；`ü` 写作 `v`。
- 同一篇出现在两部集子里（正文去标点后一致）时共用一个文件名，只合成一次；同名同作者而正文不同的，第二篇起加 `_2`、`_3`。
- 去重按正文比对，不比题名：《唐诗三百首》的「渭城曲」与课内的《送元二使安西》是同一首，只留课内那条。
- 多音字按词定音：`岑参` 读 cēn shēn、`汉乐府` 与词牌里的「乐」读 yuè、`清平调` 读 diào、`受降城` 读 xiáng、`给事` 读 jǐ。词表在 `scripts/gen-audio-lines.js`。

## 重新生成

```bash
node scripts/gen-audio-lines.js
```

语料变了就重跑，不要手改这几份文件。读音表里没有的字在 `scripts/gen-audio-lines.js` 的 `LETTERS` 里补；单字读不出音会直接报错，不会静默写成空。
