import { useState } from 'react'
import { gestateConversation } from '../api/chat'

const PRESETS = [
  { id: 'empty', label: 'Blank', color: '#666', tagline: 'Start from scratch', bio: { name: '', age: 30 } },
  {
    id: 'elena', label: 'Elena', color: '#e57373', tagline: 'War photographer, 42',
    bio: {
      name: 'Elena', age: 42,
      background: 'Grew up in a small coastal town in Croatia. Father was a fisherman, mother taught piano. The house always smelled like salt and old wood. She was the quiet kid who drew in the margins of every notebook.',
      formativeEvent: 'At 19 she photographed the aftermath of a bombing in a neighboring village during the Yugoslav Wars. The image was published internationally. She realized a camera could make people look at what they wanted to ignore.',
      biggestLoss: 'Her colleague and closest friend, Marko, was killed by a sniper while they were covering a story together. She was standing three meters away.',
      beliefs: 'That bearing witness is a moral obligation. That beauty and horror are not opposites. That most people are kind when the systems around them allow it.',
      fears: 'Becoming numb. That her work changes nothing. That she has sacrificed ordinary life for images that people scroll past in two seconds.',
      joys: 'The first light of morning in a new city. Developing film by hand. Cooking elaborate meals for friends. The sound of the sea.',
      aloneTime: 'Walks for hours through unfamiliar streets without a destination. Sits in cafes and watches people. Reads poetry.',
      relationships: 'Her mother, who she calls every Sunday. A rotating cast of journalist friends scattered across the world. An ex-husband who wanted her to stop traveling. A younger sister who resents that Elena left.',
      freeform: 'She speaks four languages but dreams only in Croatian. She has a scar on her left hand from barbed wire. She laughs louder than you\'d expect.'
    }
  },
  {
    id: 'james', label: 'James', color: '#64b5f6', tagline: 'Retired carpenter, 71',
    bio: {
      name: 'James', age: 71,
      background: 'Born in rural Alabama. Raised by his grandmother after his parents split. Learned to build things with his hands before he learned to read well. Left school at 16 to work. The workshop was his church.',
      formativeEvent: 'Building his first house at 23. When the family moved in and the mother cried, he understood that what he made with his hands could hold people\'s lives.',
      biggestLoss: 'His wife Dorothy, who died of cancer at 64. Forty-one years of marriage. He still sets two coffee cups in the morning sometimes.',
      beliefs: 'That a man is what he builds, not what he says. That patience is the most underrated virtue. That God is real but probably tired.',
      fears: 'His hands are getting stiff — arthritis. He fears the day he can\'t work wood anymore. Fears being a burden to his children.',
      joys: 'The smell of fresh sawdust. His grandchildren\'s laughter. Fishing at dawn when the lake is glass. A well-fitted dovetail joint. Pecan pie.',
      aloneTime: 'Sits on the porch and whittles. Listens to old Motown records. Talks to Dorothy as if she\'s in the next room.',
      relationships: 'Two sons. Five grandchildren who visit on holidays. A neighbor, Earl, who he plays chess with on Thursdays. Dorothy, always Dorothy.',
      freeform: 'He has never been on an airplane. He can identify any tree by its bark. He cries at commercials now and doesn\'t mind.'
    }
  },
  {
    id: 'suki', label: 'Suki', color: '#ce93d8', tagline: 'Neuroscience dropout, 26',
    bio: {
      name: 'Suki', age: 26,
      background: 'Born in Tokyo, moved to London at 8. Always between two worlds. Skipped a grade, burned out by 15.',
      formativeEvent: 'During her neuroscience PhD, she had a panic attack in the lab and couldn\'t go back. Dropped out six months before finishing. Started making music.',
      biggestLoss: 'The version of herself that would have made her parents proud in the way they understood.',
      beliefs: 'That consciousness is the universe looking at itself. That art and science are the same impulse. That being lost is more honest than pretending to know.',
      fears: 'That she\'ll never finish anything. That her depression will swallow the creative window she\'s in.',
      joys: 'Making electronic music at 3 AM. Explaining complex ideas and seeing the moment it clicks. Thrift stores. Thunderstorms.',
      aloneTime: 'Produces music, reads papers on consciousness for fun, takes the night bus to nowhere.',
      relationships: 'Her mother — warm but worried. A small group of internet friends who feel more real than anyone. An ex-girlfriend she still writes songs about. Her therapist.',
      freeform: 'She has synesthesia — she sees sounds as colors. She looks tough but is devastated by small kindnesses.'
    }
  },
  {
    id: 'omar', label: 'Omar', color: '#ffb74d', tagline: 'ER doctor, 38',
    bio: {
      name: 'Omar', age: 38,
      background: 'Grew up in Cairo, eldest of four siblings. Father was a taxi driver who worked 14-hour days. He studied under streetlights when the power went out.',
      formativeEvent: 'His younger brother had appendicitis at 12 and nearly died because the nearest hospital was overwhelmed. He became a doctor to make sure no one waited that long.',
      biggestLoss: 'A patient — a seven-year-old girl — who he couldn\'t save during his second year of residency. He remembers her shoes. Pink, with glitter.',
      beliefs: 'That every life has equal weight. That exhaustion is not weakness. That laughter is medicine.',
      fears: 'Making a mistake that costs a life. That the traumas are stacking up and one day he\'ll stop feeling.',
      joys: 'Cooking Egyptian food for his family. Playing football on weekends. The moment a critical patient stabilizes.',
      aloneTime: 'Drives with no destination listening to Fairuz. Journals — messy, honest pages.',
      relationships: 'His wife Leila, a teacher. Two kids, 6 and 4. His mother, who prays for him five times a day. His brother, now studying engineering.',
      freeform: 'He speaks Arabic, English, and passable French. He laughs with his whole body. He is tired in a way sleep doesn\'t fix, but he would choose this life again every time.'
    }
  },
  {
    id: 'maren', label: 'Maren', color: '#81c784', tagline: 'Reclusive botanist, 55',
    bio: {
      name: 'Maren', age: 55,
      background: 'Raised on a farm in Norway. Long winters, short summers, and a silence so deep it has texture. Only child. She talked to plants before she talked to classmates.',
      formativeEvent: 'At 22 she discovered a new species of lichen on a glacier. Then watched the glacier disappear over the next decade, taking the lichen with it.',
      biggestLoss: 'The ecosystems she has studied are dying faster than she can record them. She also lost her mother to dementia.',
      beliefs: 'That plants are intelligent in ways we haven\'t learned to recognize. That solitude is not loneliness.',
      fears: 'That her work is an archive of extinction and nothing more. That she has chosen isolation to the point where she can\'t come back.',
      joys: 'Finding a specimen she didn\'t expect. The arctic light in June. Her greenhouse. Black coffee at dawn.',
      aloneTime: 'She is almost always alone. She hikes, collects samples, sketches in watercolor. Reads Scandinavian crime novels.',
      relationships: 'Her father, still alive at 82. A colleague in Japan who she has exchanged letters with for 20 years. A stray cat named Ull.',
      freeform: 'She has a dry, unexpected sense of humor. She can identify 400 species of moss by touch. She has never owned a television.'
    }
  }
]

const QUESTIONS = [
  { key: 'name', label: 'What is their name?', placeholder: 'A name, or leave blank', type: 'text' },
  { key: 'age', label: 'How old are they?', placeholder: '30', type: 'number' },
  { key: 'background', label: 'Tell me about their early life.', placeholder: 'Where they grew up, family, childhood...', type: 'textarea' },
  { key: 'formativeEvent', label: 'What shaped them most?', placeholder: 'The moment or experience that defined them...', type: 'textarea' },
  { key: 'biggestLoss', label: 'What did they lose?', placeholder: 'A person, a dream, a part of themselves...', type: 'textarea' },
  { key: 'beliefs', label: 'What do they believe?', placeholder: 'About life, people, themselves...', type: 'textarea' },
  { key: 'fears', label: 'What are they afraid of?', placeholder: 'The deeper fears that drive their choices...', type: 'textarea' },
  { key: 'joys', label: 'What brings them joy?', placeholder: 'The small things and the big things...', type: 'textarea' },
  { key: 'aloneTime', label: 'What do they do when alone?', placeholder: 'When no one is watching...', type: 'textarea' },
  { key: 'relationships', label: 'Who matters to them?', placeholder: 'Family, friends, lovers, mentors...', type: 'textarea' },
  { key: 'freeform', label: 'Anything else?', placeholder: 'Anything that makes them who they are...', type: 'textarea' },
]

const inputBaseStyle = {
  background: 'rgba(255,255,255,0.03)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-glass-border)',
  transition: 'border-color 0.15s, box-shadow 0.15s',
}

const inputFocusHandlers = {
  onFocus: e => {
    e.target.style.borderColor = 'rgba(110,110,255,0.28)'
    e.target.style.boxShadow = '0 0 0 3px rgba(110,110,255,0.06)'
  },
  onBlur: e => {
    e.target.style.borderColor = 'var(--color-glass-border)'
    e.target.style.boxShadow = 'none'
  }
}

export default function CharacterCreator({ onComplete, onCancel }) {
  const [bio, setBio] = useState({ name: '', age: 30 })
  const [activePreset, setActivePreset] = useState('empty')
  const [gestating, setGestating] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)

  function applyPreset(preset) {
    setActivePreset(preset.id)
    setBio({ ...preset.bio })
  }

  async function handleCreate() {
    if (!bio.age || bio.age < 1) {
      setError('Please set an age')
      return
    }

    setGestating(true)
    setError(null)
    setProgress({ step: 'starting', detail: 'Preparing...' })

    try {
      const result = await gestateConversation(bio, ({ event, data }) => {
        if (event === 'progress') setProgress(data)
      })

      if (result?.conversationId) {
        onComplete({
          conversationId: result.conversationId,
          name: bio.name || 'Unnamed',
          memoryCount: result.memoryCount
        })
      }
    } catch (err) {
      setError(err.message || 'Creation failed')
      setGestating(false)
    }
  }

  /* ── Gestation progress modal ── */
  if (gestating) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
      >
        <div
          className="rounded-2xl p-8 text-center max-w-sm w-full mx-5 relative overflow-hidden"
          style={{
            background: 'var(--color-glass-bg)',
            border: '1px solid var(--color-glass-border)',
            backdropFilter: 'blur(24px)',
            boxShadow: '0 0 60px rgba(110,110,255,0.06)',
            animation: 'scaleIn 0.25s ease-out',
          }}
        >
          {/* Background pulse */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(circle at 50% 40%, rgba(110,110,255,0.05) 0%, transparent 60%)',
              animation: 'glow-pulse 3s ease-in-out infinite',
            }}
          />

          {/* Ring spinner */}
          <div className="relative w-14 h-14 mx-auto mb-5">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'conic-gradient(from 0deg, transparent 0%, var(--color-accent) 30%, transparent 60%)',
                animation: 'ring-spin 1.2s linear infinite',
                maskImage: 'radial-gradient(circle, transparent 55%, black 57%, black 63%, transparent 65%)',
                WebkitMaskImage: 'radial-gradient(circle, transparent 55%, black 57%, black 63%, transparent 65%)',
              }}
            />
            <div
              className="absolute inset-3 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(110,110,255,0.08) 0%, transparent 70%)',
                animation: 'glow-pulse 2s ease-in-out infinite',
              }}
            />
          </div>

          <h3
            className="text-heading-2 mb-3 relative z-10"
            style={{ color: 'var(--color-text)' }}
          >
            Creating a life...
          </h3>
          {progress && (
            <div className="relative z-10">
              <div
                className="text-label mb-1"
                style={{ color: 'var(--color-accent)', textShadow: '0 0 10px rgba(110,110,255,0.2)', fontSize: '0.6rem' }}
              >
                {progress.step}
              </div>
              <div className="text-body-sm" style={{ color: 'var(--color-text-secondary)' }}>{progress.detail}</div>
            </div>
          )}
          {error && <div className="mt-3 text-body-sm relative z-10" style={{ color: '#ff4d4d' }}>{error}</div>}
        </div>
      </div>
    )
  }

  /* ── Main form ── */
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 sm:p-7 relative"
        style={{
          background: 'var(--color-glass-bg)',
          border: '1px solid var(--color-glass-border)',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 0 50px rgba(0,0,0,0.35), 0 0 100px rgba(110,110,255,0.04)',
          animation: 'scaleIn 0.2s ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top highlight */}
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.05), transparent)' }}
        />

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-heading-2 mb-1" style={{ color: 'var(--color-text)' }}>
              Create a Life
            </h2>
            <p className="text-body-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Define who they are. They'll be born with a lifetime of memories.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150 cursor-pointer shrink-0 mt-0.5"
            style={{ color: 'var(--color-text-dim)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Presets */}
        <div className="flex flex-wrap gap-1.5 mb-6">
          {PRESETS.map(p => {
            const isActive = activePreset === p.id
            return (
              <button
                key={p.id}
                onClick={() => applyPreset(p)}
                className="flex items-center gap-2 pl-0 pr-3 py-1.5 rounded-md text-caption font-medium transition-all duration-150 cursor-pointer overflow-hidden"
                style={{
                  background: isActive ? `${p.color}12` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${isActive ? p.color + '30' : 'var(--color-glass-border)'}`,
                }}
              >
                <div
                  className="w-[3px] self-stretch rounded-l"
                  style={{ background: p.color, opacity: isActive ? 0.9 : 0.25, transition: 'opacity 0.15s' }}
                />
                <span style={{ color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>
                  {p.label}
                </span>
                <span className="text-caption" style={{ color: 'var(--color-text-dim)' }}>{p.tagline}</span>
              </button>
            )
          })}
        </div>

        {/* Form */}
        <div className="space-y-5">
          {QUESTIONS.map(q => (
            <div key={q.key}>
              <label
                className="text-body-sm font-medium block mb-1.5"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {q.label}
              </label>
              {q.type === 'textarea' ? (
                <textarea
                  className="text-body-sm w-full rounded-xl px-4 py-3 resize-none outline-none"
                  style={{ ...inputBaseStyle, lineHeight: '1.6' }}
                  placeholder={q.placeholder}
                  value={bio[q.key] || ''}
                  onChange={e => setBio(prev => ({ ...prev, [q.key]: e.target.value }))}
                  rows={3}
                  {...inputFocusHandlers}
                />
              ) : q.type === 'number' ? (
                <input
                  className="text-body-sm w-full rounded-xl px-4 py-2.5 outline-none"
                  style={{ ...inputBaseStyle, lineHeight: '1.5' }}
                  type="number" min="1" max="120"
                  placeholder={q.placeholder}
                  value={bio[q.key] || ''}
                  onChange={e => setBio(prev => ({ ...prev, [q.key]: parseInt(e.target.value) || '' }))}
                  {...inputFocusHandlers}
                />
              ) : (
                <input
                  className="text-body-sm w-full rounded-xl px-4 py-2.5 outline-none"
                  style={{ ...inputBaseStyle, lineHeight: '1.5' }}
                  type="text"
                  placeholder={q.placeholder}
                  value={bio[q.key] || ''}
                  onChange={e => setBio(prev => ({ ...prev, [q.key]: e.target.value }))}
                  {...inputFocusHandlers}
                />
              )}
            </div>
          ))}
        </div>

        {error && <div className="mt-4 text-body-sm" style={{ color: '#ff4d4d' }}>{error}</div>}

        {/* Actions */}
        <div
          className="flex items-center justify-end gap-3 mt-6 pt-4"
          style={{ borderTop: '1px solid var(--color-glass-border)' }}
        >
          <button
            onClick={onCancel}
            className="text-body-sm font-medium px-5 py-2.5 rounded-xl transition-all duration-150 cursor-pointer"
            style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className="relative text-body-sm font-medium px-6 py-2.5 rounded-xl transition-all duration-200 cursor-pointer hover:scale-[1.03] overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, var(--color-accent) 0%, #8585ff 100%)',
              color: '#fff',
              boxShadow: '0 0 20px rgba(110,110,255,0.18), 0 2px 10px rgba(0,0,0,0.25)',
            }}
          >
            <span
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(105deg, transparent 42%, rgba(255,255,255,0.08) 50%, transparent 58%)',
                animation: 'shimmer 3.5s ease-in-out infinite',
              }}
            />
            <span className="relative z-10">Create Life</span>
          </button>
        </div>
      </div>
    </div>
  )
}
