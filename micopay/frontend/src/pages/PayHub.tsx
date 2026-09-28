import { useTranslation } from 'react-i18next';
import { useWalletBalance } from '../hooks/useWalletBalance';
import { ASSETS } from '../constants/assets';
import BetaBanner from '../components/BetaBanner';
import { Label } from '../components/ui';

interface PayHubProps {
  onSend: () => void;
  onReceive: () => void;
}

const PayHub = ({ onSend, onReceive }: PayHubProps) => {
  const { t } = useTranslation();
  const { tokens, loading } = useWalletBalance();

  return (
    <div className="bg-surface text-on-surface font-body min-h-screen flex flex-col pb-28">
      <header className="fixed top-0 left-0 w-full z-50 flex items-center px-6 py-4 pt-[max(1rem,env(safe-area-inset-top))] bg-papel border-b-2 border-tinta">
        <h1 className="font-headline font-bold text-xl text-tinta">{t('pay.title')}</h1>
      </header>

      <main className="flex-1 mt-[calc(5rem+env(safe-area-inset-top))] px-6 space-y-6 max-w-md mx-auto w-full">
        {/* Antes del saldo, a proposito: la cifra se lee como real. */}
        <BetaBanner className="-mx-6 mb-6" />
        <p className="text-on-surface-variant font-medium opacity-70 pt-2">{t('pay.subtitle')}</p>

        {/* Primary actions */}
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={onSend}
            className="bg-primary text-papel rounded-sm p-6 flex flex-col items-start gap-3 active:translate-x-[2px] active:translate-y-[2px] transition-all"
          >
            {/* El icono FIJA su color: el boton es `text-papel` y el tile es
                `bg-papel`, asi que heredarlo lo dejaba papel sobre papel. */}
            <span className="w-12 h-12 rounded-sm bg-papel flex items-center justify-center">
              <span aria-hidden="true" className="material-symbols-outlined text-2xl text-verde">arrow_upward</span>
            </span>
            <span className="font-headline font-bold text-lg">{t('pay.send')}</span>
            <span className="text-[12px] text-papel text-left leading-snug">{t('pay.sendDesc')}</span>
          </button>

          <button
            onClick={onReceive}
            className="bg-papel border-2 border-tinta rounded-sm p-6 flex flex-col items-start gap-3 active:translate-x-[2px] active:translate-y-[2px] transition-all"
          >
            <span className="w-12 h-12 rounded-sm bg-primary/10 flex items-center justify-center">
              <span aria-hidden="true" className="material-symbols-outlined text-2xl text-primary">qr_code_2</span>
            </span>
            <span className="font-headline font-bold text-lg text-on-surface">{t('pay.receive')}</span>
            <span className="text-[12px] text-on-surface-variant text-left leading-snug">{t('pay.receiveDesc')}</span>
          </button>
        </div>

        {/* Balances */}
        <section>
          <h2 className="mb-3"><Label>{t('pay.yourAssets')}</Label></h2>
          <div className="bg-papel rounded-sm border-2 border-tinta divide-y divide-linea">
            {ASSETS.map((a) => {
              const bal = tokens.find((t) => t.code.toLowerCase() === a.code.toLowerCase())?.balance ?? 0;
              return (
                <div key={a.code} className="flex items-center gap-3 p-4">
                  {/* El codigo completo: `slice(0, 4)` imprimia "CETE". El
                      cintillo es lo unico que distingue un activo de otro
                      (§4.3: ningun activo tiene color), asi que no se recorta. */}
                  <span className="w-10 h-10 rounded-sm border-2 border-tinta bg-verde text-papel flex items-center justify-center flex-shrink-0 font-black text-[10px] tracking-tight" >
                    {a.code.toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-on-surface text-sm">{a.label}</p>
                    <p className="text-[11px] text-gris">{a.code}</p>
                  </div>
                  <p className="font-bold text-on-surface text-sm whitespace-nowrap">
                    {loading ? '…' : bal.toLocaleString('es-MX', { maximumFractionDigits: a.decimals })}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
};

export default PayHub;
