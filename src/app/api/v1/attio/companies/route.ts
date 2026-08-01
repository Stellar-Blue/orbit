import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, attributeSlug, whitelistValues } = body;

    const cleanToken = (token || '').trim();
    const targetSlug = attributeSlug || 'relationship_type';
    const targetWhitelist: string[] = Array.isArray(whitelistValues) ? whitelistValues : [];

    if (!cleanToken || cleanToken.length < 8) {
      return NextResponse.json(
        { success: false, error: 'No Attio API Key configured. Please save your valid Attio Access Token in Orbit Settings.' },
        { status: 400 }
      );
    }

    // Attempt to query Attio v2 Records API for companies (trying both 'companies' and 'company' object slugs)
    let response = await fetch('https://api.attio.com/v2/objects/companies/records/query', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ limit: 200 }),
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok && response.status === 404) {
      // Try singular object name as alternative in Attio v2 schema
      response = await fetch('https://api.attio.com/v2/objects/company/records/query', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ limit: 200 }),
        signal: AbortSignal.timeout(12000)
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `Attio API returned HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(errorText);
        if (parsed?.message || parsed?.error) {
          errorMsg = parsed.message || (typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error));
        }
      } catch (e) {
        // use raw text if not json
        if (errorText && errorText.length < 200) errorMsg = errorText;
      }
      return NextResponse.json({
        success: false,
        error: `Failed to fetch companies from Attio API: ${errorMsg}. Please verify your API Key has Read Records permissions in Attio.`
      }, { status: response.status });
    }

    const data = await response.json();
    if (!data?.data || !Array.isArray(data.data)) {
      return NextResponse.json({
        success: true,
        source: 'live_api',
        count: 0,
        companies: []
      });
    }

    const liveCompanies = data.data.map((rec: any) => {
      const recordId = rec.id?.record_id || rec.id || 'attio_unknown_id';
      
      // Helper to safely extract value from Attio record values map
      const getValue = (slugs: string[]) => {
        if (!rec.values) return '';
        for (const slug of slugs) {
          const field = rec.values[slug];
          if (Array.isArray(field) && field.length > 0) {
            const item = field[0];
            // Select option or status option
            if (item.option && item.option.title) return item.option.title;
            if (item.status && item.status.title) return item.status.title;
            // Domain root or email or phone
            if (item.root_domain) return item.root_domain;
            if (item.email_address) return item.email_address;
            // Plain text / numbers / titles / names
            if (typeof item.value !== 'undefined' && item.value !== null) return String(item.value);
            if (item.title) return String(item.title);
            if (item.name) return String(item.name);
            if (typeof item === 'string') return item;
          }
        }
        return '';
      };

      const name = getValue(['name', 'company_name', 'title', 'legal_name', 'company']) || `Attio Entity (${String(recordId).slice(-6)})`;
      const relationship = getValue([targetSlug, 'relationship_type', 'relationship_status', 'status', 'type', 'category']) || 'Active Record';
      const countryRaw = getValue(['country', 'billing_country', 'country_code', 'hq_country', 'address']) || 'Europe';
      const vat = getValue(['vat', 'vat_number', 'tax_id', 'registration_number', 'afm', 'tax_code']) || '';
      const domain = getValue(['domain', 'website', 'url', 'company_domain', 'web_address']) || '';
      const arrRaw = getValue(['arr', 'estimated_arr', 'mrr', 'revenue', 'value', 'contract_value']);

      let role: 'client' | 'supplier' | 'both' = 'client';
      const relLow = relationship.toLowerCase();
      if (relLow.includes('suppl') || relLow.includes('vendor') || relLow.includes('cost')) {
        role = 'supplier';
      } else if (relLow.includes('both') || relLow.includes('partner') || relLow.includes('joint')) {
        role = 'both';
      }

      let estArr = 0;
      if (arrRaw && !isNaN(Number(arrRaw))) {
        estArr = Number(arrRaw);
      }

      return {
        attio_record_id: recordId,
        legal_name: name,
        relationship_status: relationship,
        country_code: countryRaw.length === 2 ? countryRaw.toUpperCase() : countryRaw,
        vat_number: vat || 'N/A in Attio',
        domain: domain,
        suggested_role: role,
        estimated_arr: estArr
      };
    });

    // Filter by qualifying whitelist statuses if specified and if matches exist
    let resultCompanies = liveCompanies;
    if (targetWhitelist.length > 0) {
      const strictMatches = liveCompanies.filter((c: any) => 
        targetWhitelist.some((val: string) => 
          c.relationship_status.toLowerCase() === val.toLowerCase() ||
          c.relationship_status.toLowerCase().includes(val.toLowerCase())
        )
      );
      // If user's whitelist matches specific companies, return those; otherwise return all live companies from their Attio account so nothing is hidden
      if (strictMatches.length > 0) {
        resultCompanies = strictMatches;
      }
    }

    return NextResponse.json({
      success: true,
      source: 'live_attio_api',
      count: resultCompanies.length,
      companies: resultCompanies
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: `Server network error connecting to Attio: ${error?.message || 'Timeout or network exception'}` },
      { status: 500 }
    );
  }
}
