import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Archive from './pages/Archive'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/archive" element={<Archive />} />
    </Routes>
  )
}
