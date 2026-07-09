import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Politica de Privacidade | M10 Intermediacoes",
  description: "Politica de privacidade da M10 Intermediacoes para atendimento, WhatsApp e CRM."
};

const sections = [
  {
    title: "1. Quem somos",
    body: [
      "A M10 Intermediacoes realiza atendimento comercial e operacional relacionado a produtos financeiros, simulacoes, acompanhamento de propostas e relacionamento com clientes.",
      "Esta politica explica como tratamos dados pessoais recebidos em nossos canais oficiais, incluindo WhatsApp, telefone, formularios, CRM e demais meios de atendimento."
    ]
  },
  {
    title: "2. Dados pessoais que podemos tratar",
    body: [
      "Podemos tratar dados como nome, telefone, e-mail, CPF, data de nascimento, cidade, estado, dados profissionais, informacoes de margem ou beneficio, historico de atendimento, mensagens enviadas por WhatsApp e documentos fornecidos pelo proprio cliente.",
      "Tambem podemos registrar dados tecnicos e operacionais, como data e horario de contato, status de proposta, origem do atendimento e responsavel pelo acompanhamento."
    ]
  },
  {
    title: "3. Finalidades do tratamento",
    body: [
      "Utilizamos os dados para identificar o cliente, responder solicitacoes, realizar simulacoes, analisar elegibilidade, acompanhar propostas, enviar comunicados sobre o atendimento e cumprir obrigacoes legais, regulatórias e contratuais.",
      "Tambem podemos usar os dados para seguranca, prevencao a fraudes, auditoria interna, melhoria dos processos de atendimento e organizacao do relacionamento comercial."
    ]
  },
  {
    title: "4. Atendimento pelo WhatsApp",
    body: [
      "Quando o cliente entra em contato pelo WhatsApp ou autoriza comunicacoes por esse canal, as mensagens podem ser processadas por ferramentas oficiais da Meta/WhatsApp Business Platform e integradas ao CRM usado pela M10 Intermediacoes.",
      "As mensagens recebidas e enviadas podem ficar registradas para continuidade do atendimento, controle de qualidade, historico de relacionamento e comprovacao das interacoes realizadas."
    ]
  },
  {
    title: "5. Compartilhamento de dados",
    body: [
      "Podemos compartilhar dados com bancos, correspondentes, parceiros operacionais, provedores de tecnologia, plataformas de comunicacao, ferramentas de CRM, hospedagem, seguranca e prestadores necessarios para executar o atendimento solicitado.",
      "O compartilhamento ocorre apenas quando necessario para as finalidades descritas nesta politica, para cumprimento legal ou mediante autorizacao do titular quando exigido pela legislacao aplicavel."
    ]
  },
  {
    title: "6. Bases legais",
    body: [
      "O tratamento de dados pessoais pode ocorrer com base na execucao de procedimentos preliminares ou contrato, consentimento, cumprimento de obrigacao legal ou regulatoria, exercicio regular de direitos, protecao ao credito e legitimo interesse, conforme a Lei Geral de Protecao de Dados Pessoais (LGPD).",
      "Quando a base legal for o consentimento, o titular podera revoga-lo pelos canais de atendimento da M10 Intermediacoes."
    ]
  },
  {
    title: "7. Retencao e seguranca",
    body: [
      "Mantemos os dados pelo tempo necessario para prestar atendimento, cumprir obrigacoes legais, preservar direitos, prevenir fraudes e manter historico operacional adequado.",
      "Adotamos medidas tecnicas e administrativas para proteger os dados contra acesso nao autorizado, perda, uso indevido, alteracao ou divulgacao indevida."
    ]
  },
  {
    title: "8. Direitos do titular",
    body: [
      "Nos termos da LGPD, o titular pode solicitar confirmacao de tratamento, acesso, correcao, anonimização, bloqueio, eliminacao, portabilidade, informacoes sobre compartilhamento e revisao de decisoes automatizadas, quando aplicavel.",
      "As solicitacoes serao analisadas de acordo com a legislacao vigente e podem depender de validacao de identidade para seguranca do proprio titular."
    ]
  },
  {
    title: "9. Contato",
    body: [
      "Para exercer direitos de privacidade ou tirar duvidas sobre esta politica, entre em contato pelos canais oficiais da M10 Intermediacoes ou pelo site https://m10assessoria.com/.",
      "Esta politica pode ser atualizada para refletir alteracoes legais, operacionais ou tecnologicas."
    ]
  }
];

export default function M10PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <section className="mx-auto max-w-4xl px-6 py-12 sm:px-8 lg:py-16">
        <div className="mb-10 border-b border-slate-200 pb-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-blue-700">
            M10 Intermediacoes
          </p>
          <h1 className="text-3xl font-bold tracking-normal text-slate-950 sm:text-4xl">
            Politica de Privacidade
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-700">
            Esta politica descreve como a M10 Intermediacoes trata dados pessoais em seus
            atendimentos comerciais, inclusive por WhatsApp e sistemas de CRM.
          </p>
          <p className="mt-3 text-sm text-slate-500">Ultima atualizacao: 9 de julho de 2026.</p>
        </div>

        <div className="space-y-8">
          {sections.map((section) => (
            <section key={section.title} className="border-b border-slate-200 pb-7 last:border-b-0">
              <h2 className="text-xl font-semibold text-slate-950">{section.title}</h2>
              <div className="mt-3 space-y-3 text-base leading-7 text-slate-700">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
