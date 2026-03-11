import { useEffect, useState, useRef } from 'react';
import Icon from '@mdi/react';
import {
  mdiPlus,
  mdiCheckCircle,
  mdiCloseCircle,
  mdiPencilOutline,
  mdiTrashCanOutline,
} from '@mdi/js';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import Modal from './Modal';
import { BASE_URL, WS_URL } from '../config';

function getBinBorderColor(bin) {
  if (bin.status === 'out') return '#cc0000';
  if (bin.status === 'out-pending') return '#cc0000';
  if (bin.status === 'in-pending') return '#2e7d32';
  return '#c8c8c8';
}

function getBinAnimationClass(bin) {
  if (bin.status === 'out-pending') return 'flash-red';
  if (bin.status === 'in-pending') return 'flash-green';
  return '';
}

function groupBins(bins) {
  const groups = {};
  for (const bin of bins) {
    const sub = bin.subcategory?.trim() || 'Uncategorized';
    if (!groups[sub]) groups[sub] = [];
    groups[sub].push(bin);
  }
  return groups;
}

async function putCategory(category, bins) {
  return fetch(`${BASE_URL}/category/${category}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bins),
  });
}

const inputStyle = {
  width: '100%',
  marginBottom: 10,
  padding: '6px 8px',
  border: '1px solid #c8c8c8',
  fontSize: 13,
  fontFamily: 'Arial, Helvetica, sans-serif',
  outline: 'none',
};

export default function BinList({ category, categoryList, parentName, selectedSubcategory, onBinsChanged }) {
  const [bins, setBins] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editIndex, setEditIndex] = useState(null);
  const [newBin, setNewBin] = useState({ name: '', barcode: '', status: 'in', subcategory: '', request: 'no' });
  const clientRef = useRef(null);

  // Single category
  useEffect(() => {
    if (!category) return;
    fetch(`${BASE_URL}/category/${category}`)
      .then(res => res.json())
      .then(setBins);
  }, [category]);

  // Parent group — fetch all categories and merge
  useEffect(() => {
    if (!categoryList?.length) return;
    Promise.all(categoryList.map(cat =>
      fetch(`${BASE_URL}/category/${cat}`).then(res => res.json()).catch(() => [])
    )).then(results => setBins(results.flat()));
  }, [categoryList]);

  // WebSocket connection is category-agnostic — connect once at mount
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => console.log('[WS] connected to backend');
    ws.onerror = (e) => console.error('[WS] connection error', e);
    ws.onclose = () => console.warn('[WS] disconnected');
    ws.onmessage = (event) => {
      try {
        const { barcode, status } = JSON.parse(event.data);
        setBins(prev => prev.map(bin =>
          bin.barcode === barcode ? { ...bin, status } : bin
        ));
      } catch (e) { console.error('[WS] message parse error', e); }
    };
    clientRef.current = ws;
    return () => ws.close();
  }, []);

  const handleBinClick = (barcode) => {
    if (!window.confirm('Retrieve bin?')) return;
    const ws = clientRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      const msg = JSON.stringify({ topic: 'bins/command', payload: { barcode, type: 'retrieve' } });
      console.log('[WS] sending', msg);
      ws.send(msg);
      setBins(prev => prev.map(bin => bin.barcode === barcode ? { ...bin, status: 'out-pending' } : bin));
    } else {
      console.error('[WS] not open, readyState:', ws?.readyState);
    }
  };

  const handleDragEnd = async ({ source, destination, draggableId }) => {
    if (!destination) return;
    const fromSubcat = source.droppableId;
    const toSubcat = destination.droppableId;
    const grouped = groupBins(bins);
    const draggedBin = grouped[fromSubcat].find(bin => bin.barcode === draggableId);
    if (!draggedBin) return;
    grouped[fromSubcat] = grouped[fromSubcat].filter(b => b.barcode !== draggableId);
    grouped[toSubcat] = [...(grouped[toSubcat] || []), { ...draggedBin, subcategory: toSubcat }];
    const newList = Object.values(grouped).flat();
    setBins(newList);
    await putCategory(category, newList);
    onBinsChanged?.();
  };

  const handleAddOrUpdateBin = async () => {
    if (!newBin.name || !newBin.barcode) return;
    let updatedBins;
    if (editIndex !== null) {
      updatedBins = [...bins];
      updatedBins[editIndex] = newBin;
      await putCategory(category, updatedBins);
    } else {
      await fetch(`${BASE_URL}/category/${category}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBin),
      });
      updatedBins = [...bins, newBin];
    }
    setBins(updatedBins);
    setShowForm(false);
    setEditIndex(null);
    setNewBin({ name: '', barcode: '', status: 'in', subcategory: '', request: 'no' });
    onBinsChanged?.();
  };

  const handleEditBin = (index) => {
    setEditIndex(index);
    setNewBin(bins[index]);
    setShowForm(true);
  };

  const handleDeleteBin = async (index) => {
    if (!window.confirm('Delete this bin?')) return;
    const updatedBins = [...bins];
    updatedBins.splice(index, 1);
    await putCategory(category, updatedBins);
    setBins(updatedBins);
    onBinsChanged?.();
  };

  const grouped = groupBins(bins);
  const visibleGroups = selectedSubcategory
    ? (grouped[selectedSubcategory] ? { [selectedSubcategory]: grouped[selectedSubcategory] } : {})
    : grouped;

  return (
    <div style={{ flex: 1, overflowY: 'auto', backgroundColor: '#ffffff' }}>
      {/* Content header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        borderBottom: '1px solid #c8c8c8',
        backgroundColor: '#f4f4f4',
      }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#003087' }}>
          {parentName ? parentName : category ? category : 'Select a category'}
          {selectedSubcategory && <span style={{ color: '#555', fontWeight: 400 }}> / {selectedSubcategory}</span>}
        </span>
        {category && !parentName && (
          <button
            onClick={() => { setShowForm(true); setEditIndex(null); setNewBin({ name: '', barcode: '', status: 'in', subcategory: '' }); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              backgroundColor: '#cc0000',
              color: '#fff',
              border: 'none',
              padding: '5px 12px',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
              letterSpacing: '0.3px',
            }}
          >
            <Icon path={mdiPlus} size={0.7} color="#fff" /> Add Bin
          </button>
        )}
      </div>

      <div style={{ padding: 16 }}>
        {showForm && (
          <Modal onClose={() => { setShowForm(false); setEditIndex(null); }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 14, color: '#003087' }}>
              {editIndex !== null ? 'Edit Bin' : 'Add Bin'}
            </h3>
            <input placeholder="Name" value={newBin.name} onChange={e => setNewBin({ ...newBin, name: e.target.value })} style={inputStyle} />
            <input placeholder="Barcode" value={newBin.barcode} onChange={e => setNewBin({ ...newBin, barcode: e.target.value })} style={inputStyle} />
            <input placeholder="Subcategory" value={newBin.subcategory} onChange={e => setNewBin({ ...newBin, subcategory: e.target.value })} style={{ ...inputStyle, marginBottom: 16 }} />
            <button
              onClick={handleAddOrUpdateBin}
              style={{ backgroundColor: '#cc0000', color: '#fff', border: 'none', padding: '7px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
            >
              {editIndex !== null ? 'Save' : 'Add'}
            </button>
          </Modal>
        )}

        <DragDropContext onDragEnd={handleDragEnd}>
          {Object.entries(visibleGroups).map(([subcat, list]) => (
            <div key={subcat} style={{ marginBottom: 28 }}>
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.7px',
                color: '#003087',
                marginBottom: 8,
                paddingBottom: 4,
                borderBottom: '2px solid #003087',
              }}>
                {subcat}
              </div>
              <Droppable droppableId={subcat} direction="horizontal">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                  >
                    {list.map((bin, index) => (
                      <Draggable key={bin.barcode} draggableId={bin.barcode} index={index}>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={getBinAnimationClass(bin)}
                            onClick={() => handleBinClick(bin.barcode)}
                            style={{
                              width: 148,
                              padding: '10px 10px 8px',
                              borderRadius: 2,
                              backgroundColor: '#ffffff',
                              border: `2px solid ${getBinBorderColor(bin)}`,
                              fontSize: 12,
                              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                              position: 'relative',
                              userSelect: 'none',
                              cursor: 'pointer',
                              ...provided.draggableProps.style,
                            }}
                          >
                            <div style={{ position: 'absolute', top: 4, right: 2, display: 'flex' }}>
                              <button
                                onClick={e => { e.stopPropagation(); handleEditBin(bins.findIndex(b => b.barcode === bin.barcode)); }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 3px', color: '#666' }}
                                title="Edit"
                              >
                                <Icon path={mdiPencilOutline} size={0.6} />
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); handleDeleteBin(bins.findIndex(b => b.barcode === bin.barcode)); }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 3px', color: '#cc0000' }}
                                title="Delete"
                              >
                                <Icon path={mdiTrashCanOutline} size={0.6} />
                              </button>
                            </div>

                            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2, paddingRight: 36, color: '#1a1a1a' }}>
                              {bin.name}
                            </div>
                            <div style={{ color: '#777', fontSize: 11, marginBottom: 6, fontFamily: 'Courier New, monospace' }}>
                              {bin.barcode}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Icon
                                path={bin.status === 'in' || bin.status === 'in-pending' ? mdiCheckCircle : mdiCloseCircle}
                                size={0.65}
                                color={bin.status === 'out' || bin.status === 'out-pending' ? '#cc0000' : '#2e7d32'}
                              />
                              <span style={{ fontSize: 11, fontWeight: 600, color: bin.status === 'out' || bin.status === 'out-pending' ? '#cc0000' : '#2e7d32' }}>
                                {bin.status === 'in' ? 'In Stock' : bin.status === 'out' ? 'Out' : bin.status === 'in-pending' ? 'Storing…' : 'Retrieving…'}
                              </span>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </DragDropContext>
      </div>
    </div>
  );
}
