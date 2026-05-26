export type CltBank = {
  id: string;
  name: string;
  provider: "manual" | "newcorban" | "bank-api";
  products: string[];
  tags: string[];
};

export type CltCustomerData = {
  cpf: string;
  name: string;
  birthDate: string;
  phone?: string;
  gender: string;
  registry: string;
  employerDocument: string;
  employerName: string;
  admissionDate: string;
  income: number;
  availableMargin: number;
  zipCode: string;
  state: string;
  city: string;
  district: string;
  address: string;
  number: string;
};

export type CltSimulationInput = {
  bankId: string;
  cpf: string;
  phone: string;
  product: string;
  income?: number;
  availableMargin?: number;
  installmentAmount?: number;
  installments?: number;
  includeInsurance?: boolean;
};

export type CltSimulationOffer = {
  id: string;
  bankId: string;
  bankName: string;
  product: string;
  tableCode: string;
  tableName: string;
  installments: number;
  monthlyRate: number;
  installmentAmount: number;
  financedAmount: number;
  releasedAmount: number;
  availableMargin: number;
  includeInsurance: boolean;
};

export const cltBanks: CltBank[] = [
  {
    id: "mercantil",
    name: "Mercantil",
    provider: "newcorban",
    products: ["NOVO - DIGITAL CONSIGNADO PRIVADO CORBAN"],
    tags: ["CLT", "Credito do Trabalhador"]
  },
  {
    id: "c6-ficsa",
    name: "C6 Ficsa",
    provider: "manual",
    products: ["Credito do Trabalhador CLT"],
    tags: ["CLT", "Margem"]
  },
  {
    id: "bmg",
    name: "BMG",
    provider: "manual",
    products: ["Credito do Trabalhador"],
    tags: ["CLT", "Aumento"]
  },
  {
    id: "3rn",
    name: "3RN",
    provider: "manual",
    products: ["Credito do Trabalhador"],
    tags: ["CLT"]
  }
];

export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function formatCpf(value: string) {
  const digits = onlyDigits(value).slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export function isValidCpfShape(value: string) {
  return onlyDigits(value).length === 11;
}

export function getCltBank(bankId: string) {
  return cltBanks.find((bank) => bank.id === bankId) ?? cltBanks[0];
}

export function enrichCltCustomer({
  cpf,
  phone
}: {
  cpf: string;
  phone?: string;
}): CltCustomerData {
  const digits = onlyDigits(cpf);

  return {
    cpf: formatCpf(digits),
    name: "Cliente CLT em simulacao",
    birthDate: "1990-01-10",
    phone,
    gender: "Nao informado",
    registry: `0000${digits.slice(-6)}`,
    employerDocument: "59358606",
    employerName: "Empresa vinculada ao eSocial",
    admissionDate: new Date().toISOString().slice(0, 10),
    income: 1621,
    availableMargin: 372.76,
    zipCode: "04466080",
    state: "SP",
    city: "SAO PAULO",
    district: "JD ITAPURA",
    address: "Endereco retornado pelo provedor",
    number: "147"
  };
}

export function simulateClt(input: CltSimulationInput): CltSimulationOffer[] {
  const bank = getCltBank(input.bankId);
  const income = Number(input.income || 1621);
  const margin = Number(input.availableMargin || input.installmentAmount || income * 0.23);
  const installments = Number(input.installments || 48);
  const installmentAmount = Number(input.installmentAmount || margin);
  const insuranceFactor = input.includeInsurance === false ? 0.985 : 1;
  const financedAmount = installmentAmount * installments * 0.333;
  const releasedAmount = financedAmount * 0.965 * insuranceFactor;

  const mercantilByNewcorban = bank.id === "mercantil" && bank.provider === "newcorban";

  return [
    {
      id: `${bank.id}-padrao-${installments}`,
      bankId: bank.id,
      bankName: bank.name,
      product: input.product || bank.products[0],
      tableCode: bank.id === "mercantil" ? "6714" : "CLT-001",
      tableName: mercantilByNewcorban
        ? "Tabela Normal/Padrao - Newcorban assistido"
        : "Tabela Normal/Padrao",
      installments,
      monthlyRate: 4.98,
      installmentAmount: Number(installmentAmount.toFixed(2)),
      financedAmount: Number(financedAmount.toFixed(2)),
      releasedAmount: Number(releasedAmount.toFixed(2)),
      availableMargin: Number(margin.toFixed(2)),
      includeInsurance: input.includeInsurance !== false
    }
  ];
}
