import { Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import ChatPage from './pages/ChatPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/chat" element={<ChatPage />} />
    </Routes>
  )
}
