import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import BinList from './components/BinList';
import { BASE_URL } from './config';
import './App.css';

function App() {
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState(null);
  const sidebarRef = useRef();

  const loadCategories = useCallback(() => {
    fetch(`${BASE_URL}/categories`)
      .then(res => res.json())
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  useEffect(() => {
    if (categories.length && !selectedCategory) {
      setSelectedCategory(categories[0]);
    }
  }, [categories, selectedCategory]);

  useEffect(() => { setSelectedSubcategory(null); }, [selectedCategory]);

  const handleBinsChanged = useCallback(() => {
    loadCategories();
    sidebarRef.current?.refreshExpandedBins();
  }, [loadCategories]);

  return (
    <div className="app-shell">
      <div className="app-topbar">
        <h1>BIN <span>ROSTER</span></h1>
      </div>
      <div className="app-body">
        <Sidebar
          ref={sidebarRef}
          categories={categories}
          selectedCategory={selectedCategory}
          onSelect={cat => setSelectedCategory(cat)}
          reloadCategories={loadCategories}
          selectedSubcategory={selectedSubcategory}
          setSelectedSubcategory={setSelectedSubcategory}
        />
        <BinList
          category={selectedCategory}
          selectedSubcategory={selectedSubcategory?.subcat}
          onBinsChanged={handleBinsChanged}
        />
      </div>
    </div>
  );
}

export default App;
