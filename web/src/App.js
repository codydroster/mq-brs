import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import BinList from './components/BinList';
import { BASE_URL } from './config';
import './App.css';

function App() {
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState(null);
  const [selectedParent, setSelectedParent] = useState(null); // { name, categories }
  const sidebarRef = useRef();

  const loadCategories = useCallback(() => {
    fetch(`${BASE_URL}/categories`)
      .then(res => res.json())
      .then(data => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  useEffect(() => {
    if (categories.length && !selectedCategory && !selectedParent) {
      setSelectedCategory(categories[0]);
    }
  }, [categories, selectedCategory, selectedParent]);

  useEffect(() => { setSelectedSubcategory(null); }, [selectedCategory]);

  const handleSelectCategory = (cat) => {
    setSelectedCategory(cat);
    setSelectedParent(null);
  };

  const handleSelectParent = (parentName, parentCategories) => {
    setSelectedParent({ name: parentName, categories: parentCategories });
    setSelectedCategory(null);
    setSelectedSubcategory(null);
  };

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
          selectedParent={selectedParent?.name}
          onSelect={handleSelectCategory}
          onSelectParent={handleSelectParent}
          reloadCategories={loadCategories}
          selectedSubcategory={selectedSubcategory}
          setSelectedSubcategory={setSelectedSubcategory}
        />
        <BinList
          category={selectedCategory}
          categoryList={selectedParent?.categories}
          parentName={selectedParent?.name}
          selectedSubcategory={selectedSubcategory?.subcat}
          onBinsChanged={handleBinsChanged}
        />
      </div>
    </div>
  );
}

export default App;
