import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Archive from './pages/Archive'
import Workbench from './pages/Workbench'
import MiniAssistant from './pages/MiniAssistant'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/archive" element={<Archive />} />
      <Route path="/workbench" element={<Workbench />} />
      <Route path="/assistant" element={<MiniAssistant />} />
    </Routes>
  )
}
