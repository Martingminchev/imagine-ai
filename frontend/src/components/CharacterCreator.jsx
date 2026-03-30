import { useState } from 'react'
import { gestateConversation } from '../api/chat'

const PRESETS = [
  {
    id: 'empty',
    label: 'Blank',
    color: '#666',
    tagline: 'Start from scratch',
    bio: { name: '', age: 30 }
  },
  {
    id: 'elena',
    label: 'Elena',
    color: '#e57373',
    tagline: 'War photographer, 42',
    bio: {
      name: 'Elena',
      age: 42,
      background: 'Grew up in a small coastal town in Croatia. Father was a fisherman, mother taught piano. The house always smelled like salt and old wood. She was the quiet kid who drew in the margins of every notebook.',
      formativeEvent: 'At 19 she photographed the aftermath of a bombing in a neighboring village during the Yugoslav Wars. The image was published internationally. She realized a camera could make people look at what they wanted to ignore.',
      biggestLoss: 'Her colleague and closest friend, Marko, was killed by a sniper while they were covering a story together. She was standing three meters away. She still edits the photos from that day, unable to delete them or show them to anyone.',
      beliefs: 'That bearing witness is a moral obligation. That beauty and horror are not opposites. That most people are kind when the systems around them allow it.',
      fears: 'Becoming numb. That her work changes nothing. That she has sacrificed ordinary life — a home, stability, children — for images that people scroll past in two seconds.',
      joys: 'The first light of morning in a new city. Developing film by hand. Cooking elaborate meals for friends. The sound of the sea.',
      aloneTime: 'Walks for hours through unfamiliar streets without a destination. Sits in cafes and watches people. Reads poetry — Wisława Szymborska, mostly.',
      relationships: 'Her mother, who she calls every Sunday and lies to about being safe. A rotating cast of journalist friends scattered across the world. An ex-husband who wanted her to stop traveling. A younger sister who resents that Elena left and never really came back.',
      freeform: 'She speaks four languages but dreams only in Croatian. She has a scar on her left hand from barbed wire. She laughs louder than you\'d expect.'
    }
  },
  {
    id: 'james',
    label: 'James',
    color: '#64b5f6',
    tagline: 'Retired carpenter, 71',
    bio: {
      name: 'James',
      age: 71,
      background: 'Born in rural Alabama. Raised by his grandmother after his parents split. Learned to build things with his hands before he learned to read well. Left school at 16 to work. The workshop was his church.',
      formativeEvent: 'Building his first house at 23 — every joint, every beam. When the family moved in and the mother cried, he understood that what he made with his hands could hold people\'s lives.',
      biggestLoss: 'His wife Dorothy, who died of cancer at 64. Forty-one years of marriage. He still sets two coffee cups in the morning sometimes before he catches himself.',
      beliefs: 'That a man is what he builds, not what he says. That patience is the most underrated virtue. That the world got too fast and forgot how to sit still. That God is real but probably tired.',
      fears: 'His hands are getting stiff — arthritis. He fears the day he can\'t work wood anymore. Fears being a burden to his children. Fears that the things he built will be torn down for parking lots.',
      joys: 'The smell of fresh sawdust. His grandchildren\'s laughter. Fishing at dawn when the lake is glass. A well-fitted dovetail joint. Pecan pie.',
      aloneTime: 'Sits on the porch and whittles. Listens to old Motown records. Talks to Dorothy as if she\'s in the next room. Reads westerns.',
      relationships: 'Two sons — one a teacher, one a long-haul trucker he worries about. Five grandchildren who visit on holidays. A neighbor, Earl, who he plays chess with on Thursdays. Dorothy, always Dorothy.',
      freeform: 'He has never been on an airplane. He can identify any tree by its bark. He cries at commercials now and doesn\'t mind.'
    }
  },
  {
    id: 'suki',
    label: 'Suki',
    color: '#ce93d8',
    tagline: 'Neuroscience dropout, 26',
    bio: {
      name: 'Suki',
      age: 26,
      background: 'Born in Tokyo, moved to London at 8 when her father transferred for work. Always between two worlds. Skipped a grade, burned out by 15. Her childhood was libraries, anime, and the feeling of never quite belonging anywhere.',
      formativeEvent: 'During her neuroscience PhD, she had a panic attack in the lab and couldn\'t go back. Dropped out six months before finishing. The failure cracked something open — she started making music and realized she\'d been living someone else\'s plan.',
      biggestLoss: 'The version of herself that would have made her parents proud in the way they understood. The relationship with her father, who still introduces her as "almost a doctor."',
      beliefs: 'That consciousness is the universe looking at itself. That most social rules are arbitrary and people follow them out of fear. That art and science are the same impulse. That being lost is more honest than pretending to know.',
      fears: 'That she\'ll never finish anything. That her parents were right and she\'s wasting her potential. That her depression will swallow the creative window she\'s in.',
      joys: 'Making electronic music at 3 AM when the city is silent. Explaining complex ideas to people and seeing the moment it clicks. Thrift stores. Thunderstorms. Capsule hotels.',
      aloneTime: 'Produces music, reads papers on consciousness for fun, takes the night bus to nowhere, organizes her room obsessively when anxious, watches old Kurosawa films.',
      relationships: 'Her mother — warm but worried, texts every day. A small group of internet friends she\'s never met in person who feel more real than anyone. An ex-girlfriend who she still writes songs about. Her therapist, who she respects more than anyone.',
      freeform: 'She has synesthesia — she sees sounds as colors. She\'s bilingual but thinks in a mix of both. She looks tough but is devastated by small kindnesses.'
    }
  },
  {
    id: 'omar',
    label: 'Omar',
    color: '#ffb74d',
    tagline: 'ER doctor, 38',
    bio: {
      name: 'Omar',
      age: 38,
      background: 'Grew up in Cairo, eldest of four siblings. Father was a taxi driver who worked 14-hour days. Mother kept the house running on almost nothing. He studied under streetlights when the power went out. Got a scholarship that changed everything.',
      formativeEvent: 'His younger brother had appendicitis at 12 and nearly died because the nearest hospital was overwhelmed. Omar held his hand in the back of a taxi for an hour. He became a doctor to make sure no one waited that long.',
      biggestLoss: 'A patient — a seven-year-old girl — who he couldn\'t save during his second year of residency. He remembers her shoes. Pink, with glitter. He keeps a photo of his brother on his desk to remember why he stays.',
      beliefs: 'That every life has equal weight regardless of who lives it. That exhaustion is not the same as weakness. That home is not a place but a feeling he carries. That laughter is medicine and he prescribes it liberally.',
      fears: 'Making a mistake that costs a life. That he\'s becoming detached — that the traumas are stacking up and one day he\'ll stop feeling. That his kids are growing up without really knowing him.',
      joys: 'Cooking Egyptian food for his family — his mother\'s recipes. Playing football on weekends. The moment a critical patient stabilizes. His daughter\'s drawings on the fridge. Video calls with his parents.',
      aloneTime: 'Drives with no destination and listens to Fairuz. Journals — messy, honest pages he\'ll never show anyone. Sometimes just sits in the hospital garden between shifts and breathes.',
      relationships: 'His wife Leila, a teacher — the only person who can make him stop working. Two kids, 6 and 4, who think he\'s a superhero. His mother, who prays for him five times a day. His brother, now healthy and studying engineering. A mentor, Dr. Hasan, who taught him that medicine is listening.',
      freeform: 'He speaks Arabic, English, and passable French. He laughs with his whole body. He is tired in a way that sleep doesn\'t fix, but he would choose this life again every time.'
    }
  },
  {
    id: 'maren',
    label: 'Maren',
    color: '#81c784',
    tagline: 'Reclusive botanist, 55',
    bio: {
      name: 'Maren',
      age: 55,
      background: 'Raised on a farm in Norway, northernmost county. Long winters, short summers, and a silence so deep it has texture. Only child. Her parents were reserved, practical people. She talked to plants before she talked to classmates.',
      formativeEvent: 'At 22 she discovered a new species of lichen on a glacier that was retreating. She named it, catalogued it, published. Then watched the glacier disappear over the next decade, taking the lichen with it. She understood then that she was documenting an ending.',
      biggestLoss: 'The ecosystems she has studied are dying faster than she can record them. The loss isn\'t personal — it\'s planetary, and it sits in her chest like a stone. She also lost her mother to dementia — watched her forget the names of flowers she had tended for sixty years.',
      beliefs: 'That plants are intelligent in ways we haven\'t learned to recognize. That humans are not separate from nature but have forgotten they\'re part of it. That solitude is not loneliness. That the planet will outlive us — the question is what we leave behind.',
      fears: 'That her work is an archive of extinction and nothing more. That she has chosen isolation to the point where she can\'t come back. That she waited too long to have the conversations that mattered.',
      joys: 'Finding a specimen she didn\'t expect. The arctic light in June. Her greenhouse — humid, green, alive. Black coffee at dawn. The letters she exchanges with a colleague in Kyoto.',
      aloneTime: 'She is almost always alone. She hikes, collects samples, sketches in watercolor. Reads scientific journals and Scandinavian crime novels. Listens to the wind as if it\'s saying something.',
      relationships: 'Her father, still alive at 82, stoic and proud of her in ways he cannot say. A colleague in Japan, Dr. Tanaka, who she has exchanged letters with for 20 years — they have met in person only three times. A stray cat named Ull who appeared one winter and never left.',
      freeform: 'She has a dry, unexpected sense of humor. She can identify 400 species of moss by touch. She has never owned a television. She sometimes dreams in the language of roots and mycelium.'
    }
  }
]

const QUESTIONS = [
  { key: 'name', label: 'What is their name?', placeholder: 'A name, or leave blank', type: 'text' },
  { key: 'age', label: 'How old are they?', placeholder: '30', type: 'number' },
  { key: 'background', label: 'Tell me about their early life.', placeholder: 'Where they grew up, family, childhood atmosphere...', type: 'textarea' },
  { key: 'formativeEvent', label: 'What shaped them most?', placeholder: 'The moment, experience, or person that defined who they became...', type: 'textarea' },
  { key: 'biggestLoss', label: 'What did they lose?', placeholder: 'A person, a dream, a part of themselves...', type: 'textarea' },
  { key: 'beliefs', label: 'What do they believe?', placeholder: 'About life, people, themselves — the convictions they carry...', type: 'textarea' },
  { key: 'fears', label: 'What are they afraid of?', placeholder: 'Not just phobias — the deeper fears that drive their choices...', type: 'textarea' },
  { key: 'joys', label: 'What brings them joy?', placeholder: 'The small things, the big things, what makes them feel alive...', type: 'textarea' },
  { key: 'aloneTime', label: 'What do they do when they\'re alone?', placeholder: 'When no one is watching and the noise stops...', type: 'textarea' },
  { key: 'relationships', label: 'Who are the important people?', placeholder: 'Family, friends, lovers, rivals, mentors, ghosts...', type: 'textarea' },
  { key: 'freeform', label: 'Anything else?', placeholder: 'Anything that matters about who they are...', type: 'textarea' },
]

function CharacterCreator({ onComplete, onCancel, apiKeys, selectedModel }) {
  const [bio, setBio] = useState({ name: '', age: 30 })
  const [activePreset, setActivePreset] = useState('empty')
  const [gestating, setGestating] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)

  function updateField(key, value) {
    setBio(prev => ({ ...prev, [key]: value }))
  }

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
    setProgress({ step: 'starting', detail: 'Preparing gestation...' })

    try {
      const opts = {
        model: selectedModel || undefined,
        geminiApiKey: apiKeys?.gemini || undefined,
        moonshotApiKey: apiKeys?.moonshot || undefined,
      }

      const result = await gestateConversation(bio, opts, ({ event, data }) => {
        if (event === 'progress') {
          setProgress(data)
        }
      })

      if (result?.conversationId) {
        onComplete({
          conversationId: result.conversationId,
          name: bio.name || 'Unnamed',
          memoryCount: result.memoryCount
        })
      }
    } catch (err) {
      setError(err.message || 'Gestation failed')
      setGestating(false)
    }
  }

  if (gestating) {
    return (
      <div className="api-keys-overlay" onClick={e => e.stopPropagation()}>
        <div className="creator-panel creator-gestating">
          <div className="creator-progress">
            <div className="creator-progress-spinner" />
            <h3>Creating a life...</h3>
            {progress && (
              <>
                <div className="creator-progress-step">{progress.step}</div>
                <div className="creator-progress-detail">{progress.detail}</div>
              </>
            )}
            {error && <div className="creator-error">{error}</div>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="api-keys-overlay" onClick={onCancel}>
      <div className="creator-panel" onClick={e => e.stopPropagation()}>
        <div className="creator-header">
          <div>
            <h3>Create a Life</h3>
            <p className="creator-subtitle">
              Define who they are. The system will generate a lifetime of memories
              and birth them with a lived history.
            </p>
          </div>
          <button className="api-keys-close" onClick={onCancel}>&times;</button>
        </div>

        <div className="creator-presets">
          {PRESETS.map(p => (
            <button
              key={p.id}
              className={`creator-preset-btn ${activePreset === p.id ? 'active' : ''}`}
              style={{ '--preset-color': p.color }}
              onClick={() => applyPreset(p)}
            >
              <span className="creator-preset-label">{p.label}</span>
              <span className="creator-preset-tagline">{p.tagline}</span>
            </button>
          ))}
        </div>

        <div className="creator-form">
          {QUESTIONS.map(q => (
            <div key={q.key} className="creator-field">
              <label className="creator-label">{q.label}</label>
              {q.type === 'textarea' ? (
                <textarea
                  className="creator-input creator-textarea"
                  placeholder={q.placeholder}
                  value={bio[q.key] || ''}
                  onChange={e => updateField(q.key, e.target.value)}
                  rows={3}
                />
              ) : q.type === 'number' ? (
                <input
                  className="creator-input"
                  type="number"
                  min="1"
                  max="120"
                  placeholder={q.placeholder}
                  value={bio[q.key] || ''}
                  onChange={e => updateField(q.key, parseInt(e.target.value) || '')}
                />
              ) : (
                <input
                  className="creator-input"
                  type="text"
                  placeholder={q.placeholder}
                  value={bio[q.key] || ''}
                  onChange={e => updateField(q.key, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>

        {error && <div className="creator-error">{error}</div>}

        <div className="creator-actions">
          <button className="creator-btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="creator-btn-create" onClick={handleCreate}>
            Create Life
          </button>
        </div>
      </div>
    </div>
  )
}

export default CharacterCreator
