import { useState, useImperativeHandle, forwardRef } from 'react';
import Icon from '@mdi/react';
import { mdiPlus, mdiFolderOpen, mdiFolder, mdiChevronDown, mdiChevronRight } from '@mdi/js';
import Modal from './Modal';
import { BASE_URL } from '../config';

const S = {
  sidebar: {
    width: 200,
    minWidth: 200,
    backgroundColor: '#f4f4f4',
    borderRight: '1px solid #c8c8c8',
    height: '100%',
    boxSizing: 'border-box',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 10px',
    borderBottom: '1px solid #c8c8c8',
    backgroundColor: '#e8e8e8',
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    color: '#003087',
  },
  addBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 2,
    display: 'flex',
    alignItems: 'center',
    color: '#003087',
  },
  catRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 8px',
    cursor: 'pointer',
    borderBottom: '1px solid #e4e4e4',
  },
  catRowActive: {
    backgroundColor: '#003087',
  },
  catFolderBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    marginRight: 4,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  catLabel: (isSelected) => ({
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
    color: isSelected ? '#ffffff' : '#1a1a1a',
    padding: 0,
    textAlign: 'left',
    flex: 1,
  }),
  subcatSection: {
    backgroundColor: '#ffffff',
    borderBottom: '1px solid #e4e4e4',
  },
  subcatRow: (isSelected) => ({
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px 4px 24px',
    backgroundColor: isSelected ? '#e8f0fb' : 'transparent',
    borderLeft: isSelected ? '3px solid #003087' : '3px solid transparent',
    cursor: 'pointer',
  }),
  subcatChevronBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    marginRight: 2,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  subcatLabel: (isSelected) => ({
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    color: isSelected ? '#003087' : '#333',
    fontWeight: isSelected ? 700 : 400,
    padding: 0,
    textAlign: 'left',
    flex: 1,
  }),
  binItem: {
    fontSize: 11,
    color: '#555',
    padding: '2px 8px 2px 46px',
    cursor: 'pointer',
  },
  emptyMsg: {
    fontSize: 11,
    color: '#999',
    padding: '4px 8px 4px 24px',
    fontStyle: 'italic',
  },
};

const Sidebar = forwardRef(function Sidebar(
  { categories, selectedCategory, onSelect, reloadCategories, selectedSubcategory, setSelectedSubcategory },
  ref
) {
  const [showModal, setShowModal] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [expandedCategories, setExpandedCategories] = useState(new Set());
  const [binsMap, setBinsMap] = useState({});
  const [expandedSubcats, setExpandedSubcats] = useState({});

  useImperativeHandle(ref, () => ({
    refreshExpandedBins: async () => {
      const results = await Promise.all(
        [...expandedCategories].map(cat =>
          fetch(`${BASE_URL}/category/${cat}`)
            .then(res => res.ok ? res.json().then(bins => [cat, bins]) : null)
            .catch(() => null)
        )
      );
      setBinsMap(b => ({
        ...b,
        ...Object.fromEntries(results.filter(Boolean)),
      }));
    }
  }));

  const addCategory = async () => {
    if (!newCategory) return;
    const res = await fetch(`${BASE_URL}/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newCategory }),
    });
    if (res.ok) {
      reloadCategories?.();
      setNewCategory('');
      setShowModal(false);
    }
  };

  const toggleCategory = (cat) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
        fetch(`${BASE_URL}/category/${cat}`).then(res => res.ok && res.json().then(bins =>
          setBinsMap(b => ({ ...b, [cat]: bins }))
        ));
      }
      return next;
    });
  };

  const toggleSubcat = (cat, subcat) => {
    setExpandedSubcats(prev => {
      const prevSet = new Set(prev[cat] || []);
      if (prevSet.has(subcat)) prevSet.delete(subcat); else prevSet.add(subcat);
      return { ...prev, [cat]: prevSet };
    });
  };

  return (
    <div style={S.sidebar}>
      <div style={S.header}>
        <span style={S.headerLabel}>Categories</span>
        <button style={S.addBtn} onClick={() => setShowModal(true)} title="Add category">
          <Icon path={mdiPlus} size={0.8} color="#003087" />
        </button>
      </div>

      {categories.map(cat => {
        const isSelected = cat === selectedCategory;
        const isExpanded = expandedCategories.has(cat);
        return (
          <div key={cat}>
            <div style={{ ...S.catRow, ...(isSelected && !isExpanded ? S.catRowActive : {}) }}>
              <button style={S.catFolderBtn} onClick={() => toggleCategory(cat)} title={isExpanded ? 'Collapse' : 'Expand'}>
                <Icon
                  path={isExpanded ? mdiFolderOpen : mdiFolder}
                  size={0.75}
                  color={isSelected && !isExpanded ? '#ffffff' : '#003087'}
                />
              </button>
              <button
                style={S.catLabel(isSelected && !isExpanded)}
                onClick={() => { onSelect(cat); setSelectedSubcategory(null); }}
              >
                {cat}
              </button>
            </div>

            {isExpanded && binsMap[cat] && (
              <div style={S.subcatSection}>
                {binsMap[cat].length === 0 && <div style={S.emptyMsg}>No bins</div>}
                {[...new Set(binsMap[cat].map(bin => bin.subcategory || 'Uncategorized'))].map(subcat => {
                  const isSubSelected = selectedSubcategory?.cat === cat && selectedSubcategory?.subcat === subcat;
                  const isSubExpanded = expandedSubcats[cat]?.has(subcat);
                  return (
                    <div key={subcat}>
                      <div style={S.subcatRow(isSubSelected)}>
                        <button style={S.subcatChevronBtn} onClick={() => toggleSubcat(cat, subcat)}>
                          <Icon
                            path={isSubExpanded ? mdiChevronDown : mdiChevronRight}
                            size={0.65}
                            color={isSubSelected ? '#003087' : '#666'}
                          />
                        </button>
                        <button
                          style={S.subcatLabel(isSubSelected)}
                          onClick={() => { setSelectedSubcategory({ subcat, cat }); onSelect(cat); }}
                        >
                          {subcat}
                        </button>
                      </div>
                      {isSubExpanded && binsMap[cat]
                        .filter(bin => (bin.subcategory || 'Uncategorized') === subcat)
                        .map(bin => (
                          <div
                            key={bin.barcode}
                            style={S.binItem}
                            onClick={() => { setSelectedSubcategory({ subcat, cat }); onSelect(cat); }}
                          >
                            {bin.name}
                          </div>
                        ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {showModal && (
        <Modal onClose={() => setShowModal(false)}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#003087' }}>Add Category</h3>
          <input
            placeholder="Category name"
            value={newCategory}
            onChange={e => setNewCategory(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCategory()}
            autoFocus
            style={{ width: '100%', marginBottom: 12, padding: '6px 8px', border: '1px solid #c8c8c8', fontSize: 13 }}
          />
          <button
            onClick={addCategory}
            style={{ backgroundColor: '#cc0000', color: '#fff', border: 'none', padding: '7px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            Add
          </button>
        </Modal>
      )}
    </div>
  );
});

export default Sidebar;
