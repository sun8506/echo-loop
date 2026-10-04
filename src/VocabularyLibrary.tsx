import { useState } from 'react'
import { Bookmark, Star, Trash2 } from 'lucide-react'
import LearnerBottomNav from './LearnerBottomNav'
import { toHiragana } from './materialQuality'
import { getSavedSentences, getSavedWords, removeSavedSentence, removeSavedWord } from './learnerVocabulary'

export default function VocabularyLibrary() {
  const [tab, setTab] = useState<'words' | 'sentences'>('words')
  const [words, setWords] = useState(getSavedWords)
  const [sentences, setSentences] = useState(getSavedSentences)
  return <main className="vocabulary-page">
    <header className="vocabulary-header"><div><small>MY COLLECTION</small><h1>我的词汇</h1></div></header>
    <section className="vocabulary-main">
      <div className="vocabulary-tabs"><button className={tab === 'words' ? 'active' : ''} onClick={() => setTab('words')}><Star/>单词本 <b>{words.length}</b></button><button className={tab === 'sentences' ? 'active' : ''} onClick={() => setTab('sentences')}><Bookmark/>句子本 <b>{sentences.length}</b></button></div>
      {tab === 'words'
        ? <div className="vocabulary-list">{words.length ? words.map(item => <article key={item.id}><div><h2>{item.surface}</h2>{(item.readingKatakana || item.reading) && <p>{toHiragana(item.reading || item.readingKatakana || '')}</p>}<small>{item.courseTitle}</small></div><button aria-label="删除单词" onClick={() => { removeSavedWord(item.id); setWords(getSavedWords()) }}><Trash2/></button></article>) : <div className="vocabulary-empty">在学习画面点选单词，再按 W 或点击“加入单词本”。</div>}</div>
        : <div className="vocabulary-list sentence-list">{sentences.length ? sentences.map(item => <article key={item.id}><div><h2>{item.cue.text}</h2>{(item.cue.readingKatakana || item.cue.reading) && <p>{toHiragana(item.cue.reading || item.cue.readingKatakana || '')}</p>}<small>{item.courseTitle} · {Math.floor(item.cue.start / 60)}:{Math.floor(item.cue.start % 60).toString().padStart(2, '0')}</small></div><button aria-label="删除句子" onClick={() => { removeSavedSentence(item.id); setSentences(getSavedSentences()) }}><Trash2/></button></article>) : <div className="vocabulary-empty">在学习画面按 S 或点击“收藏句子”。</div>}</div>}
    </section>
    <LearnerBottomNav active="vocabulary"/>
  </main>
}
