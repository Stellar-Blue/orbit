"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Building2, Save, AlertCircle } from "lucide-react";
import { notifySuccess } from "@/lib/validation-modal";

export function GeneralSettings() {
  const { companyProfile, updateCompanyProfile } = useAuth();
  const [name, setName] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (companyProfile) {
      setName(companyProfile.name || "");
      setVatNumber(companyProfile.vat_number || "");
      setLogoUrl(companyProfile.logo_url || "");
    }
  }, [companyProfile]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const ok = await updateCompanyProfile({
        name,
        vat_number: vatNumber,
        logo_url: logoUrl
      });
      if (ok) {
        notifySuccess("Corporate Profile updated successfully.");
      } else {
        setError("Failed to update corporate profile.");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50/50 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center border border-slate-200">
              <Building2 className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">Corporate Profile</h2>
              <p className="text-xs text-slate-500">Global branding and tax information</p>
            </div>
          </div>
        </div>
        
        <div className="p-6 space-y-5">
          {error && (
            <div className="flex items-start space-x-3 bg-rose-50 border border-rose-200 p-4 rounded-xl text-sm text-rose-800">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Legal Company Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20 focus:border-[#3D87D3]"
              placeholder="e.g. StellarBlue"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">VAT Number</label>
            <input
              type="text"
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20 focus:border-[#3D87D3]"
              placeholder="e.g. 802309756"
            />
            <p className="text-[11px] text-slate-500 mt-1.5">
              This VAT number is used by default for the myDATA integration sync direction (issued vs received).
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Logo URL</label>
            <input
              type="text"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#3D87D3]/20 focus:border-[#3D87D3]"
              placeholder="e.g. /logo.png"
            />
          </div>

          <div className="pt-2">
            <button
              onClick={handleSave}
              disabled={isSaving || !name.trim()}
              className="flex items-center justify-center space-x-2 w-full sm:w-auto bg-[#3D87D3] hover:bg-[#3D87D3]/90 text-white px-6 py-2.5 rounded-xl font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? "Saving..." : "Save Profile"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
