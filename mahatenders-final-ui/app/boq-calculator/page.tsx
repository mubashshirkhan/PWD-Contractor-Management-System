"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/section-header";

type Item = { id: number; description: string; quantity: string; rate: string };

export default function BoqCalculatorPage() {
  const [items, setItems] = useState<Item[]>([{ id: 1, description: "", quantity: "", rate: "" }]);
  const total = useMemo(() => items.reduce((sum, item) => {
    const quantity = Number(item.quantity);
    const rate = Number(item.rate);
    return sum + (Number.isFinite(quantity * rate) ? quantity * rate : 0);
  }, 0), [items]);

  function update(id: number, field: keyof Omit<Item, "id">, value: string) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));
  }

  return <div>
    <SectionHeader eyebrow="BOQ Calculator" title="Estimate item costs" description="Enter quantities and rates to calculate a bill of quantities total." />
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <h2 className="font-serif text-xl">BOQ items</h2>
        <Button variant="secondary" onClick={() => setItems((current) => [...current, { id: Date.now(), description: "", quantity: "", rate: "" }])}><Plus className="h-4 w-4" /> Add item</Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="data-table w-full min-w-[700px]"><thead><tr><th>Description</th><th>Quantity</th><th>Rate (₹)</th><th>Amount (₹)</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{items.map((item) => {
              const quantity = Number(item.quantity);
              const rate = Number(item.rate);
              const amount = Number.isFinite(quantity * rate) ? quantity * rate : 0;
              return <tr key={item.id}>
                <td><input className="field min-w-56" aria-label="Item description" value={item.description} onChange={(event) => update(item.id, "description", event.target.value)} placeholder="Work item" /></td>
                <td><input className="field w-28" aria-label="Quantity" inputMode="decimal" value={item.quantity} onChange={(event) => update(item.id, "quantity", event.target.value)} placeholder="0" /></td>
                <td><input className="field w-36" aria-label="Rate" inputMode="decimal" value={item.rate} onChange={(event) => update(item.id, "rate", event.target.value)} placeholder="0.00" /></td>
                <td className="whitespace-nowrap">{amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                <td><button className="rounded p-2 text-muted hover:bg-field hover:text-danger" aria-label="Remove item" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))}><Trash2 className="h-4 w-4" /></button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="mt-5 flex justify-end border-t border-line pt-4"><p className="text-sm text-muted">Estimated total <strong className="ml-3 text-lg text-ink">₹{total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</strong></p></div>
      </CardContent>
    </Card>
  </div>;
}
