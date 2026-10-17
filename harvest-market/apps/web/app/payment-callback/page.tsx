'use client';
import { useEffect, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, X, Loader2 } from 'lucide-react';

function CallbackContent() {
  const params = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const interactRef = params.get('interact_ref');
    const paymentId = params.get('payment_id') || (typeof window !== 'undefined' ? sessionStorage.getItem('op_payment_id') : null);

    if (!interactRef) {
      // Maybe we already have success/error from a previous redirect
      const success = params.get('payment_success');
      const error = params.get('payment_error');
      if (success) { setStatus('success'); setTimeout(() => { window.location.href = '/?payment_success=' + success; }, 2500); return; }
      if (error) { setStatus('error'); setErrorMsg(error); setTimeout(() => { window.location.href = '/?payment_error=' + encodeURIComponent(error); }, 3000); return; }
      // No params — go home
      setTimeout(() => { window.location.href = '/'; }, 2000);
      return;
    }

    if (!paymentId) {
      setStatus('error');
      setErrorMsg('No se encontró el ID del pago. Cierra sesión e intenta de nuevo.');
      setTimeout(() => { window.location.href = '/?payment_error=no_payment_id'; }, 3000);
      return;
    }

    // Call the API (via Next.js proxy) to complete the payment
    fetch(`/api/payment-callback?interact_ref=${encodeURIComponent(interactRef)}&payment_id=${encodeURIComponent(paymentId)}`)
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          if (typeof window !== 'undefined') sessionStorage.removeItem('op_payment_id');
          setStatus('success');
          setTimeout(() => { window.location.href = '/?payment_success=' + paymentId; }, 2500);
        } else {
          setStatus('error');
          setErrorMsg(data.error || 'Error desconocido');
          setTimeout(() => { window.location.href = '/?payment_error=' + encodeURIComponent(data.error || 'Payment failed'); }, 3000);
        }
      })
      .catch(err => {
        setStatus('error');
        setErrorMsg(err.message);
        setTimeout(() => { window.location.href = '/?payment_error=' + encodeURIComponent(err.message); }, 3000);
      });
  }, [params]);

  return (
    <div className="shell">
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: '1.5rem' }}>
        {status === 'processing' ? (
          <>
            <Loader2 size={48} className="animate-spin" style={{ color: '#3b82f6' }} />
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Procesando pago…</h1>
            <p style={{ color: '#666', textAlign: 'center', maxWidth: 400 }}>
              Completando la transferencia via Open Payments…
            </p>
          </>
        ) : status === 'success' ? (
          <>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#1a7a3a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Check size={32} color="white" />
            </div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>¡Pago confirmado!</h1>
            <p style={{ color: '#666', textAlign: 'center', maxWidth: 400 }}>
              La inversión fue enviada via Open Payments. Redirigiendo al dashboard…
            </p>
            <Loader2 size={20} className="animate-spin" style={{ color: '#666' }} />
          </>
        ) : (
          <>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#c0392b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={32} color="white" />
            </div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Error en el pago</h1>
            <p style={{ color: '#666', textAlign: 'center', maxWidth: 400 }}>{errorMsg}</p>
            <p style={{ color: '#999', fontSize: '0.875rem' }}>Redirigiendo…</p>
          </>
        )}
      </main>
    </div>
  );
}

export default function PaymentCallbackPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><Loader2 size={32} className="animate-spin" /></div>}>
      <CallbackContent />
    </Suspense>
  );
}