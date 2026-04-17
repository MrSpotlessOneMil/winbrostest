"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Sliders, MessageSquare, DollarSign, Tag, ClipboardList,
  Save, Plus, Trash2, Loader2
} from "lucide-react"

export default function ControlCenterPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState("messages")

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Sliders className="w-5 h-5" />
          Control Center
        </h2>
        <p className="text-sm text-zinc-400 mt-1">
          Manage automated messages, price book, tags, and checklists
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-zinc-900 border border-zinc-800">
          <TabsTrigger value="messages" className="cursor-pointer">
            <MessageSquare className="w-3 h-3 mr-1.5" />
            Messages
          </TabsTrigger>
          <TabsTrigger value="pricebook" className="cursor-pointer">
            <DollarSign className="w-3 h-3 mr-1.5" />
            Price Book
          </TabsTrigger>
          <TabsTrigger value="tags" className="cursor-pointer">
            <Tag className="w-3 h-3 mr-1.5" />
            Tag Bank
          </TabsTrigger>
          <TabsTrigger value="checklists" className="cursor-pointer">
            <ClipboardList className="w-3 h-3 mr-1.5" />
            Checklists
          </TabsTrigger>
        </TabsList>

        {/* Automated Messages */}
        <TabsContent value="messages" className="space-y-4">
          <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-4">
            <h3 className="text-sm font-semibold text-zinc-300 mb-4">Automated Message Templates</h3>
            <p className="text-xs text-zinc-500 mb-4">
              Use {"{{customer_name}}"}, {"{{services}}"}, {"{{total}}"}, {"{{payment_method}}"}, {"{{review_link}}"} as variables.
            </p>
            <div className="space-y-4">
              {[
                { trigger: "on_my_way", label: "On My Way", default: "Hi {{customer_name}}! Your WinBros technician is on the way. See you soon!" },
                { trigger: "receipt", label: "Receipt", default: "Hi {{customer_name}}! Here's your receipt from WinBros:\n\nServices: {{services}}\nTotal: {{total}}\nPayment: {{payment_method}}\n\nThank you!" },
                { trigger: "review_request", label: "Review Request", default: "Hi {{customer_name}}! We'd really appreciate a Google review: {{review_link}}" },
                { trigger: "thank_you_tip", label: "Thank You + Tip", default: "Thanks again {{customer_name}}! Tips are always appreciated by our technicians." },
              ].map(msg => (
                <div key={msg.trigger} className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-400">{msg.label}</label>
                  <Textarea
                    defaultValue={msg.default}
                    className="min-h-[80px] text-sm"
                    placeholder={`Template for ${msg.label.toLowerCase()}...`}
                  />
                </div>
              ))}
              <Button className="cursor-pointer">
                <Save className="w-3 h-3 mr-1.5" />
                Save Messages
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* Price Book */}
        <TabsContent value="pricebook" className="space-y-4">
          <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-300">Services & Pricing</h3>
              <Button variant="outline" size="sm" className="cursor-pointer">
                <Plus className="w-3 h-3 mr-1" />
                Add Service
              </Button>
            </div>
            <div className="space-y-2">
              {[
                { name: "Interior Window Cleaning", price: 200 },
                { name: "Exterior Window Cleaning", price: 250 },
                { name: "Screen Cleaning", price: 50 },
                { name: "Gutter Cleaning", price: 150 },
                { name: "Pressure Washing", price: 300 },
              ].map((svc, i) => (
                <div key={i} className="flex items-center gap-3 p-2 bg-zinc-900 rounded">
                  <Input defaultValue={svc.name} className="text-sm flex-1" />
                  <div className="flex items-center gap-1">
                    <span className="text-zinc-500">$</span>
                    <Input defaultValue={svc.price.toString()} className="text-sm w-24" type="number" />
                  </div>
                  <Button variant="ghost" size="sm" className="text-zinc-500 hover:text-red-400 cursor-pointer">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
            <Button className="mt-4 cursor-pointer">
              <Save className="w-3 h-3 mr-1.5" />
              Save Price Book
            </Button>
          </div>
        </TabsContent>

        {/* Tag Bank */}
        <TabsContent value="tags" className="space-y-4">
          <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-300">Tag Definitions</h3>
              <Button variant="outline" size="sm" className="cursor-pointer">
                <Plus className="w-3 h-3 mr-1" />
                Add Tag
              </Button>
            </div>
            <div className="space-y-3">
              {[
                { type: "salesman", values: ["Luke", "Brennan", "Max", "Tris"] },
                { type: "team_lead", values: ["Larry", "Gary", "Terry", "Josh"] },
                { type: "service_plan", values: ["Quarterly", "Triannual", "Triannual Exterior", "Monthly"] },
              ].map(group => (
                <div key={group.type}>
                  <span className="text-xs font-medium text-zinc-400 uppercase">{group.type.replace("_", " ")}</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {group.values.map(v => (
                      <Badge key={v} variant="secondary" className="text-xs bg-zinc-800">
                        {v}
                        <button className="ml-1 hover:text-red-400 cursor-pointer">
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Checklists */}
        <TabsContent value="checklists" className="space-y-4">
          <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-300">Checklist Templates</h3>
              <Button variant="outline" size="sm" className="cursor-pointer">
                <Plus className="w-3 h-3 mr-1" />
                New Template
              </Button>
            </div>
            <div className="space-y-3">
              <div className="p-3 bg-zinc-900 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">Default Window Cleaning</span>
                  <Badge variant="secondary" className="text-[10px] bg-green-900/30 text-green-400">Default</Badge>
                </div>
                <div className="space-y-1">
                  {[
                    "Arrival confirmed with customer",
                    "Before photos taken",
                    "All windows cleaned (interior + exterior)",
                    "Screens replaced",
                    "Debris cleaned up",
                    "After photos taken",
                    "Customer walkthrough completed",
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-zinc-400">
                      <span className="text-zinc-600">{i + 1}.</span>
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
