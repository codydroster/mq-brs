export default function Modal({ children, onClose }) {
  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.45)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: '#fff',
        padding: '20px 24px 24px',
        borderRadius: 2,
        minWidth: 280,
        maxWidth: '90vw',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        position: 'relative',
        border: '1px solid #c8c8c8',
      }}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 8,
            right: 10,
            border: 'none',
            background: 'transparent',
            fontSize: '1.1rem',
            cursor: 'pointer',
            color: '#555',
            lineHeight: 1,
          }}
        >
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
