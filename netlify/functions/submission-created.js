// Runs automatically on every verified Netlify form submission (event-triggered function).
// Sends Doorstack intake requests into Follow Up Boss as a new lead, tagged "Doorstack",
// and adds a "call within 1 hour" task. Nothing is emailed or texted to the lead.
//
// Needs one environment variable in Netlify: FUB_API_KEY (Follow Up Boss > Admin > API).

const FUB = 'https://api.followupboss.com/v1';

function auth() {
  return 'Basic ' + Buffer.from(process.env.FUB_API_KEY + ':').toString('base64');
}

async function fub(path, body) {
  const res = await fetch(FUB + path, {
    method: 'POST',
    headers: {
      'Authorization': auth(),
      'Content-Type': 'application/json',
      'X-System': 'Doorstack-Website',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  if (!res.ok) throw new Error(`FUB ${path} ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

exports.handler = async (event) => {
  const { payload } = JSON.parse(event.body || '{}');
  if (!payload || payload.form_name !== 'doorstack-intake') {
    return { statusCode: 200, body: 'ignored' };
  }
  if (!process.env.FUB_API_KEY) {
    console.error('FUB_API_KEY is not set; lead not sent to Follow Up Boss', payload.data && payload.data.email);
    return { statusCode: 200, body: 'no key' };
  }

  const d = payload.data || {};
  const name = String(d.name || '').trim();
  const [firstName, ...rest] = name.split(/\s+/);
  const lastName = rest.join(' ');

  const details = [
    `Units: ${d.units || '-'}`,
    `Timeline: ${d.timeline || '-'}`,
    `Buying as: ${d.buying_as || '-'}`,
    d.notes ? `Notes: ${d.notes}` : null,
  ].filter(Boolean).join('\n');

  const person = {
    firstName: firstName || 'Doorstack',
    lastName: lastName || 'Lead',
    emails: d.email ? [{ value: d.email }] : [],
    phones: d.phone ? [{ value: d.phone }] : [],
    tags: ['Doorstack', 'Investor', `Doorstack ${d.units || 'units unknown'}`],
  };

  const ev = await fub('/events', {
    source: 'doorstack.ca',
    system: 'Doorstack-Website',
    type: 'General Inquiry',
    message: `Doorstack intake request\n${details}`,
    description: details,
    person,
  });

  const personId = ev && (ev.personId || (ev.person && ev.person.id) || ev.id);
  if (personId) {
    const due = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    try {
      await fub('/tasks', {
        personId,
        name: 'Call Doorstack lead within 1 hour',
        type: 'Call',
        dueDateTime: due,
      });
    } catch (e) {
      console.error('Lead created but task failed:', e.message);
    }
  }

  return { statusCode: 200, body: 'ok' };
};
