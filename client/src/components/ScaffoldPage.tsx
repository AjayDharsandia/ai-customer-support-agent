interface ScaffoldPageProps {
  title: string;
  description: string;
}

export function ScaffoldPage({ title, description }: ScaffoldPageProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-12">
      <p className="text-sm font-semibold uppercase tracking-widest text-teal-700">Customer Support</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
      <p className="mt-4 max-w-lg leading-relaxed text-slate-600">{description}</p>
    </section>
  );
}
