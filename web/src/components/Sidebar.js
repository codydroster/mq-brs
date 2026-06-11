import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import Icon from '@mdi/react';
import { mdiPlus, mdiFolderOpen, mdiFolder, mdiChevronDown, mdiChevronRight, mdiPencilOutline } from '@mdi/js';
import Modal from './Modal';
import { BASE_URL } from '../config';

const DEFAULT_PARENT = 'General';

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
  parentRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
    cursor: 'pointer',
    backgroundColor: '#e0e0e0',
    borderBottom: '1px solid #c8c8c8',
    borderTop: '1px solid #c8c8c8',
  },
  parentChevron: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    marginRight: 4,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  parentLabel: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: '#003087',
    flex: 1,
  },
  catRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 8px 5px 16px',
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
  editBtn: (isSelected) => ({
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '1px 2px',
    display: 'flex',
    alignItems: 'center',
    color: isSelected ? 'rgba(255,255,255,0.7)' : '#999',
    flexShrink: 0,
  }),
  subcatSection: {
    backgroundColor: '#ffffff',
    borderBottom: '1px solid #e4e4e4',
  },
  subcatRow: (isSelected) => ({
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px 4px 32px',
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
    padding: '2px 8px 2px 54px',
    cursor: 'pointer',
  },
  emptyMsg: {
    fontSize: 11,
    color: '#999',
    padding: '4px 8px 4px 32px',
    fontStyle: 'italic',
  },
  inputStyle: {
    width: '100%',
    marginBottom: 10,
    padding: '6px 8px',
    border: '1px solid #c8c8c8',
    fontSize: 13,
    boxSizing: 'border-box',
  },
  saveBtn: {
    backgroundColor: '#cc0000',
    color: '#fff',
    border: 'none',
    padding: '7px 16px',
    fontWeight: 700,
    fontSize: 13,
    cursor: 'pointer',
  },
};

const Sidebar = forwardRef(function Sidebar(
  { categories, selectedCategory, selectedParent, onSelect, onSelectParent, reloadCategories, selectedSubcategory, setSelectedSubcategory },
  ref
) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newParent, setNewParent] = useState('');

  const [editModal, setEditModal] = useState(null); // { type: 'category'|'subcategory', cat, subcat? }
  const [editName, setEditName] = useState('');
  const [editParent, setEditParent] = useState('');

  const [expandedCategories, setExpandedCategories] = useState(new Set());
  const [binsMap, setBinsMap] = useState({});
  const [expandedSubcats, setExpandedSubcats] = useState({});
  const [parents, setParents] = useState({});
  const [expandedParents, setExpandedParents] = useState(new Set([DEFAULT_PARENT]));

  const loadParents = () => {
    fetch(`${BASE_URL}/parents`)
      .then(res => res.json())
      .then(data => {
        setParents(data);
        const parentNames = new Set([DEFAULT_PARENT, ...Object.values(data)]);
        setExpandedParents(parentNames);
      })
      .catch(() => {});
  };

  useEffect(() => { loadParents(); }, []);

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
      if (newParent.trim()) {
        await fetch(`${BASE_URL}/parents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: newCategory, parent: newParent.trim() }),
        });
      }
      reloadCategories?.();
      loadParents();
      setNewCategory('');
      setNewParent('');
      setShowAddModal(false);
    }
  };

  const saveEditCategory = async () => {
    if (!editModal || !editName.trim()) return;
    const { cat } = editModal;
    const nameChanged = editName.trim() !== cat;
    const parentChanged = editParent.trim() !== (parents[cat] || '');
    if (!nameChanged && !parentChanged) { setEditModal(null); return; }

    const body = {};
    if (nameChanged) body.newName = editName.trim();
    if (parentChanged) body.parent = editParent.trim();

    const res = await fetch(`${BASE_URL}/category/${cat}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const { name: finalName } = await res.json();
      if (nameChanged && selectedCategory === cat) onSelect(finalName);
      reloadCategories?.();
      loadParents();
      setEditModal(null);
    }
  };

  const saveEditSubcategory = async () => {
    if (!editModal || !editName.trim()) return;
    const { cat, subcat } = editModal;
    if (editName.trim() === subcat) { setEditModal(null); return; }

    const res = await fetch(`${BASE_URL}/category/${cat}/subcategory`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: subcat, to: editName.trim() }),
    });
    if (res.ok) {
      setBinsMap(b => ({
        ...b,
        [cat]: (b[cat] || []).map(bin =>
          (bin.subcategory || 'Uncategorized') === subcat
            ? { ...bin, subcategory: editName.trim() }
            : bin
        ),
      }));
      if (selectedSubcategory?.cat === cat && selectedSubcategory?.subcat === subcat) {
        setSelectedSubcategory({ cat, subcat: editName.trim() });
      }
      setEditModal(null);
    }
  };

  const openEditCategory = (e, cat) => {
    e.stopPropagation();
    setEditName(cat);
    setEditParent(parents[cat] || '');
    setEditModal({ type: 'category', cat });
  };

  const openEditSubcategory = (e, cat, subcat) => {
    e.stopPropagation();
    setEditName(subcat);
    setEditModal({ type: 'subcategory', cat, subcat });
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

  const toggleParent = (parentName) => {
    setExpandedParents(prev => {
      const next = new Set(prev);
      if (next.has(parentName)) next.delete(parentName); else next.add(parentName);
      return next;
    });
  };

  // Group categories by parent
  const grouped = {};
  for (const cat of categories) {
    const parentName = parents[cat] || DEFAULT_PARENT;
    if (!grouped[parentName]) grouped[parentName] = [];
    grouped[parentName].push(cat);
  }

  const sortedParents = Object.keys(grouped).sort((a, b) => {
    if (a === DEFAULT_PARENT) return 1;
    if (b === DEFAULT_PARENT) return -1;
    return a.localeCompare(b);
  });

  const renderCategory = (cat) => {
    const isSelected = cat === selectedCategory;
    const isExpanded = expandedCategories.has(cat);
    return (
      <div key={cat}>
        <div style={{ ...S.catRow, ...(isSelected && !isExpanded ? S.catRowActive : {}) }}>
          <button style={S.catFolderBtn} onClick={() => toggleCategory(cat)}>
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
          <button style={S.editBtn(isSelected && !isExpanded)} onClick={e => openEditCategory(e, cat)} title="Edit category">
            <Icon path={mdiPencilOutline} size={0.55} />
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
                    <button style={S.editBtn(false)} onClick={e => openEditSubcategory(e, cat, subcat)} title="Edit subcategory">
                      <Icon path={mdiPencilOutline} size={0.5} />
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
  };

  return (
    <div style={S.sidebar}>
      <div style={S.header}>
        <span style={S.headerLabel}>Categories</span>
        <button style={S.addBtn} onClick={() => setShowAddModal(true)} title="Add category">
          <Icon path={mdiPlus} size={0.8} color="#003087" />
        </button>
      </div>

      {sortedParents.map(parentName => {
        const isParentSelected = selectedParent === parentName;
        return (
          <div key={parentName}>
            <div style={{ ...S.parentRow, ...(isParentSelected ? { backgroundColor: '#003087' } : {}) }}>
              <button style={S.parentChevron} onClick={() => toggleParent(parentName)}>
                <Icon
                  path={expandedParents.has(parentName) ? mdiChevronDown : mdiChevronRight}
                  size={0.65}
                  color={isParentSelected ? '#ffffff' : '#003087'}
                />
              </button>
              <span
                style={{ ...S.parentLabel, color: isParentSelected ? '#ffffff' : '#003087', cursor: 'pointer' }}
                onClick={() => onSelectParent?.(parentName, grouped[parentName])}
              >
                {parentName}
              </span>
            </div>
            {expandedParents.has(parentName) && grouped[parentName].map(renderCategory)}
          </div>
        );
      })}

      {/* Add category modal */}
      {showAddModal && (
        <Modal onClose={() => { setShowAddModal(false); setNewCategory(''); setNewParent(''); }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#003087' }}>Add Category</h3>
          <input
            placeholder="Category name"
            value={newCategory}
            onChange={e => setNewCategory(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCategory()}
            autoFocus
            style={S.inputStyle}
          />
          <input
            placeholder="Parent group (optional)"
            value={newParent}
            onChange={e => setNewParent(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCategory()}
            style={{ ...S.inputStyle, marginBottom: 12 }}
          />
          <button onClick={addCategory} style={S.saveBtn}>Add</button>
        </Modal>
      )}

      {/* Edit category modal */}
      {editModal?.type === 'category' && (
        <Modal onClose={() => setEditModal(null)}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#003087' }}>Edit Category</h3>
          <input
            placeholder="Category name"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveEditCategory()}
            autoFocus
            style={S.inputStyle}
          />
          <input
            placeholder="Parent group (leave blank for General)"
            value={editParent}
            onChange={e => setEditParent(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveEditCategory()}
            style={{ ...S.inputStyle, marginBottom: 12 }}
          />
          <button onClick={saveEditCategory} style={S.saveBtn}>Save</button>
        </Modal>
      )}

      {/* Edit subcategory modal */}
      {editModal?.type === 'subcategory' && (
        <Modal onClose={() => setEditModal(null)}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#003087' }}>Edit Subcategory</h3>
          <input
            placeholder="Subcategory name"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveEditSubcategory()}
            autoFocus
            style={{ ...S.inputStyle, marginBottom: 12 }}
          />
          <button onClick={saveEditSubcategory} style={S.saveBtn}>Save</button>
        </Modal>
      )}
    </div>
  );
});

export default Sidebar;
