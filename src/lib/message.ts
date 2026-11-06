const TEMPLATE = `{{greeting}} Dokter {{name}}

`;

export function buildMessage(greeting: string, name: string): string {
  // split/join (bukan replace dengan string) agar "$" pada nama tidak ditafsirkan khusus.
  return TEMPLATE.split("{{greeting}}")
    .join(greeting)
    .split("{{name}}")
    .join(name.trim());
}

export function waLink(phone: string, text?: string): string {
  return text
    ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${phone}`;
}
