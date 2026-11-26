"use client";

/** Última rede de segurança: qualquer erro de interface vira uma tela com "Recarregar" (os dados ficam no banco). */
export default function Erro({ error }: { error: Error }) {
  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "#0a2248",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
        padding: 32,
      }}
    >
      <div>
        <h1 style={{ margin: 0 }}>Algo deu errado</h1>
        <p style={{ opacity: 0.8 }}>{error.message}</p>
        <button
          onClick={() => location.reload()}
          style={{ minHeight: 64, padding: "0 32px", borderRadius: 999, border: 0, fontSize: 24, cursor: "pointer" }}
        >
          Recarregar
        </button>
      </div>
    </main>
  );
}
