// Serveur - Système de gestion de commandes (version minimale, étape 2)
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { openDb, verifyPassword, hashPassword } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Sessions ----------
const SESSION_DAYS = 7;
function createSession(userId) {
  const db = openDb();
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  db.close();
  return token;
}

function createClientSession(clientId) {
  const db = openDb();
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare("CREATE TABLE IF NOT EXISTS client_sessions (token TEXT PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), expires_at TEXT NOT NULL)").run();
  db.prepare('DELETE FROM client_sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO client_sessions (token, client_id, expires_at) VALUES (?, ?, ?)').run(token, clientId, expires);
  db.close();
  return token;
}

function getClient(req) {
  const token = (req.headers.cookie || '').match(/client=([a-f0-9]+)/);
  if (!token) return null;
  const db = openDb();
  db.prepare("CREATE TABLE IF NOT EXISTS client_sessions (token TEXT PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), expires_at TEXT NOT NULL)").run();
  const row = db.prepare('SELECT c.* FROM client_sessions s JOIN clients c ON c.id = s.client_id WHERE s.token = ?').get(token[1]);
  db.close();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) { clientLogout(token[1]); return null; }
  return row;
}

function clientLogout(token) {
  const db = openDb();
  db.prepare("CREATE TABLE IF NOT EXISTS client_sessions (token TEXT PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), expires_at TEXT NOT NULL)").run();
  db.prepare('DELETE FROM client_sessions WHERE token = ?').run(token);
  db.close();
}

function requireClient(req, res, next) {
  const client = getClient(req);
  if (!client) return res.redirect('/client/login');
  req.client = client;
  next();
}

function getUser(req) {
  const token = (req.headers.cookie || '').match(/session=([a-f0-9]+)/);
  if (!token) return null;
  const db = openDb();
  const row = db.prepare(`
    SELECT u.*, s.token, s.expires_at, c.name AS company_name, u.phone AS user_phone
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id
    WHERE s.token = ?`).get(token[1]);
  db.close();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) { logout(token[1]); return null; }
  return row;
}

function logout(token) {
  const db = openDb();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  db.close();
}

function requireAuth(req, res, next) {
  const user = getUser(req);
  if (!user) return res.redirect('/login');
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = getUser(req);
  if (!user || user.role !== 'admin') return res.status(403).send('Accès réservé à l\'administrateur du produit.');
  req.user = user;
  next();
}

// Le livreur n'accède qu'à ses livraisons : tout autre écran est refusé.
function requireBackOffice(req, res, next) {
  const user = getUser(req);
  if (!user) return res.redirect('/login');
  if (user.role === 'livreur') return res.status(403).send('Accès réservé : le livreur consulte uniquement ses livraisons.');
  req.user = user;
  next();
}

// L'administrateur (qui gère toutes les entreprises) ne doit pas être bloqué par les filtres par entreprise.
function companyIdFor(req) {
  return req.user.role === 'admin' ? null : req.user.company_id;
}

function log(companyId, userId, action) {
  const db = openDb();
  db.prepare('INSERT INTO action_log (company_id, user_id, action) VALUES (?, ?, ?)').run(companyId, userId, action);
  db.close();
}

const STATUS_LABELS = {
  'nouvelle': 'Nouvelle',
  'attente_confirmation': 'En attente de confirmation',
  'attente_paiement': 'En attente de paiement',
  'confirmee': 'Confirmée',
  'preparation': 'En préparation',
  'livraison': 'En livraison',
  'livree': 'Livrée',
  'annulee': 'Annulée',
};
const STATUS_ORDER = Object.keys(STATUS_LABELS);

// ---------- Pages HTML (squelettes communs) ----------
function layout(title, body, user, active) {
  active = active || '';
  const link = (href, label, icon) => `<a href="${href}" class="${active === href ? 'active' : ''}"><span class="icon">${icon}</span>${label}</a>`;
  const isCourier = user && user.role === 'livreur';
  const isAdmin = user && user.role === 'admin';
  const nav = user ? `
    <aside class="sidebar">
      <div class="brand"><span class="brand-icon">📦</span><span class="brand-text">Commandes<b>Pro</b></span></div>
      <div class="company-name">${user ? (isAdmin ? 'Vue globale — toutes les entreprises' : escapeHtml(user.company_name)) : ''}</div>
      <nav class="side-nav">
        ${user ? (isCourier ? link('/livraisons', 'Mes livraisons', '🚚') : (
          link('/', 'Tableau de bord', '📊') +
          link('/commandes', 'Commandes', '🧾') +
          link('/livraisons', 'Livraisons de demain', '🚚') +
          link('/catalogue', 'Catalogue & réglages', '🏷️') +
          (isAdmin ? link('/admin', 'Administration', '⚙️') : '') +
          (isAdmin || user.role === 'owner' ? link('/reseaux-sociaux', 'Réseaux sociaux', '🔗') : '') +
          link('/equipe', 'Équipe', '👥')
        )) : ''}
      </nav>
      <div class="sidebar-footer">
        <div class="user-avatar">${user ? escapeHtml(user.name.trim().charAt(0).toUpperCase()) : ''}</div>
        <div class="user-meta"><strong>${user ? escapeHtml(user.name) : ''}</strong><small>${user ? escapeHtml(user.role) : ''}</small></div>
        <a href="/logout" class="logout" title="Déconnexion">⏻</a>
      </div>
    </aside>` : '';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - Gestion des commandes</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
  <link rel="stylesheet" href="/style.css"></head><body class="${user ? 'app' : 'auth'}">
  ${user ? nav + '<main class="content">' + body + '</main>' : body}
  </body></html>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Routes ----------
app.get('/login', (req, res) => {
  res.send(layout('Connexion', `
    <div class="login-box">
      <h1><span>📦</span> Commandes<b style="color:var(--primary)">Pro</b></h1>
      <p class="muted">Connectez-vous pour accéder à votre espace.</p>
      <form method="post" action="/login">
        <label>Email</label><input type="email" name="email" required>
        <label>Mot de passe</label><input type="password" name="password" required>
        <button type="submit">Se connecter</button>
      </form>
      <p style="margin-top:12px"><a href="/client/login">🛍️ Vous êtes client ? Cliquez ici pour commander</a></p>
      <div class="demo-accounts">
        <strong>Comptes de démonstration :</strong>
        <ul>
          <li>Admin produit : admin@demo.cd / admin123</li>
          <li>Propriétaire : marie@elegance.cd / marie123</li>
          <li>Agent : jean@elegance.cd / jean123</li>
          <li>Livreur : patrick@elegance.cd / patrick123</li>
        </ul>
      </div>
    </div>`, null));
});

app.post('/login', (req, res) => {
  const db = openDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(req.body.email || '');
  db.close();
  if (!user || !verifyPassword(req.body.password || '', user.password_salt, user.password_hash)) {
    return res.send(layout('Connexion', `<div class="login-box"><p class="error">Email ou mot de passe incorrect.</p><a href="/login">Réessayer</a></div>`, null));
  }
  const token = createSession(user.id);
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
  log(user.company_id, user.id, 'Connexion');
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  const token = (req.headers.cookie || '').match(/session=([a-f0-9]+)/);
  if (token) logout(token[1]);
  res.setHeader('Set-Cookie', 'session=; Path=/; Max-Age=0');
  res.redirect('/login');
});

// --- Tableau de bord ---
app.get('/', requireBackOffice, (req, res) => {
  const db = openDb();
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const q = (sql, ...args) => db.prepare(sql).get(...args);
  const stats = {
    today: q(`SELECT COUNT(*) n FROM orders WHERE company_id=? AND delivery_date=? AND status NOT IN ('livree','annulee')`, req.user.company_id, today).n,
    pending: q(`SELECT COUNT(*) n FROM orders WHERE company_id=? AND status IN ('nouvelle','attente_confirmation','attente_paiement')`, req.user.company_id).n,
    tomorrow: q(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM orders WHERE company_id=? AND delivery_date=? AND status NOT IN ('livree','annulee')`, req.user.company_id, tomorrow).n,
    tomorrowTotal: q(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM orders WHERE company_id=? AND delivery_date=? AND status NOT IN ('livree','annulee')`, req.user.company_id, tomorrow).total,
  };
  const recent = db.prepare(`SELECT * FROM orders WHERE company_id=? ORDER BY id DESC LIMIT 8`).all(req.user.company_id);
  db.close();
  const rows = recent.map(o => `<tr><td><a href="/commandes/${o.id}">#${o.id}</a></td><td>${escapeHtml(o.client_name)}</td><td>${STATUS_LABELS[o.status] || o.status}</td><td>${o.amount.toLocaleString('fr-FR')} $</td><td>${o.delivery_date || '—'}</td></tr>`).join('');
  res.send(layout('Tableau de bord', `
    <h1>Tableau de bord — ${escapeHtml(req.user.company_name)}</h1>
    <div class="cards">
      <div class="card"><div class="card-num">${stats.today}</div>Commandes du jour</div>
      <div class="card"><div class="card-num">${stats.pending}</div>En attente</div>
      <div class="card"><div class="card-num">${stats.tomorrow}</div>Livraisons demain</div>
      <div class="card"><div class="card-num">${stats.tomorrowTotal.toLocaleString('fr-FR')} $</div>À encaisser demain</div>
    </div>
    <h2>Dernières commandes</h2>
    <table><tr><th>N°</th><th>Client</th><th>Statut</th><th>Montant</th><th>Livraison</th></tr>${rows}</table>
    <p><a class="btn" href="/commandes/nouvelle">+ Nouvelle commande</a></p>
  `, req.user, '/'));
});

app.get('/commandes', requireBackOffice, (req, res) => {
  const db = openDb();
  const filter = req.query.statut || '';
  let sql = `SELECT o.*, z.name AS zone_name, u.name AS courier_name FROM orders o
    LEFT JOIN zones z ON z.id=o.zone_id LEFT JOIN users u ON u.id=o.courier_id WHERE o.company_id=?`;
  const args = [req.user.company_id];
  if (filter) { sql += ' AND o.status=?'; args.push(filter); }
  sql += ' ORDER BY o.id DESC';
  const orders = db.prepare(sql).all(...args);
  db.close();
  const rows = orders.map(o => `<tr><td><a href="/commandes/${o.id}">#${o.id}</a></td><td>${escapeHtml(o.client_name)}<br><small>${escapeHtml(o.client_phone)}</small></td><td>${o.amount.toLocaleString('fr-FR')} $</td><td>${escapeHtml(o.zone_name || '—')}</td><td>${o.delivery_date || '—'}</td><td>${escapeHtml(o.courier_name || '—')}</td><td><span class="badge badge-${o.status}">${STATUS_LABELS[o.status] || o.status}</span></td></tr>`).join('');
  const filterLinks = ['<a href="/commandes">Toutes</a>'].concat(STATUS_ORDER.map(s => `<a href="/commandes?statut=${s}" class="${filter === s ? 'active' : ''}">${STATUS_LABELS[s]}</a>`)).join(' | ');
  res.send(layout('Commandes', `
    <h1>Commandes</h1>
    <p class="filters">${filterLinks}</p>
    <table><tr><th>N°</th><th>Client</th><th>Montant</th><th>Zone</th><th>Livraison</th><th>Livreur</th><th>Statut</th></tr>${rows}</table>
    <p><a class="btn" href="/commandes/nouvelle">+ Nouvelle commande</a></p>
  `, req.user, '/commandes'));
});

app.get('/commandes/nouvelle', requireBackOffice, (req, res) => {
  const db = openDb();
  const products = db.prepare('SELECT * FROM products WHERE company_id=? AND active=1').all(req.user.company_id);
  const zones = db.prepare('SELECT * FROM zones WHERE company_id=?').all(req.user.company_id);
  const couriers = db.prepare(`SELECT id, name FROM users WHERE company_id=? AND role='livreur'`).all(req.user.company_id);
  db.close();
  const productOptions = products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.price.toLocaleString('fr-FR')} $)</option>`).join('');
  res.send(layout('Nouvelle commande', `
    <h1>Nouvelle commande</h1>
    <form method="post" action="/commandes" class="form-card">
      <label>Nom du client</label><input name="client_name" required>
      <label>Téléphone du client</label><input name="client_phone" required>
      <label>Produit</label><select name="product_id" required>${productOptions}</select>
      <label>Quantité</label><input type="number" name="qty" value="1" min="1" required>
      <div class="row">
        <div><label>Zone de livraison</label><select name="zone_id">${zones.map(z => `<option value="${z.id}">${escapeHtml(z.name)} (${z.fee.toLocaleString('fr-FR')} $)</option>`).join('')}</select></div>
        <div><label>Date de livraison</label><input type="date" name="delivery_date"></div>
      </div>
      <label>Adresse</label><input name="address">
      <div class="row">
        <div><label>Statut</label><select name="status">${STATUS_ORDER.map(s => `<option value="${s}"${s === 'nouvelle' ? ' selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select></div>
        <div><label>Livreur</label><select name="courier_id"><option value="">—</option>${couriers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select></div>
      </div>
      <label>Notes</label><textarea name="notes" rows="2"></textarea>
      <button type="submit">Enregistrer la commande</button>
    </form>
  `, req.user, '/commandes'));
});

app.post('/commandes', requireBackOffice, (req, res) => {
  const db = openDb();
  const product = db.prepare('SELECT * FROM products WHERE id=? AND company_id=?').get(req.body.product_id, req.user.company_id);
  if (!product) { db.close(); return res.status(400).send('Produit introuvable.'); }
  const qty = Math.max(1, parseInt(req.body.qty || '1', 10));
  const zone = db.prepare('SELECT * FROM zones WHERE id=? AND company_id=?').get(req.body.zone_id, req.user.company_id);
  const amount = product.price * qty + (zone ? zone.fee : 0);
  const items = JSON.stringify([{ product_id: product.id, name: product.name, qty, unit_price: product.price }]);
  const resDb = db.prepare(`INSERT INTO orders (company_id, client_name, client_phone, items, amount, zone_id, address, delivery_date, courier_id, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.company_id, req.body.client_name, req.body.client_phone, items, amount, req.body.zone_id || null, req.body.address, req.body.delivery_date || null, req.body.courier_id || null, req.body.status || 'nouvelle', req.body.notes);
  db.prepare('INSERT INTO order_history (order_id, user_id, action) VALUES (?, ?, ?)').run(resDb.lastInsertRowid, req.user.id, 'Commande créée');
  log(req.user.company_id, req.user.id, `Création commande #${resDb.lastInsertRowid}`);
  db.close();
  res.redirect(`/commandes/${resDb.lastInsertRowid}`);
});

app.get('/commandes/:id', requireBackOffice, (req, res) => {
  const db = openDb();
  const o = db.prepare(`SELECT o.*, z.name AS zone_name, z.fee AS zone_fee, u.name AS courier_name FROM orders o
    LEFT JOIN zones z ON z.id=o.zone_id LEFT JOIN users u ON u.id=o.courier_id
    WHERE o.id=? AND o.company_id=?`).get(req.params.id, req.user.company_id);
  if (!o) { db.close(); return res.status(404).send('Commande introuvable.'); }
  const history = db.prepare(`SELECT h.*, u.name AS user_name FROM order_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.order_id=? ORDER BY h.id DESC`).all(o.id);
  const couriers = db.prepare(`SELECT id, name FROM users WHERE company_id=? AND role='livreur'`).all(req.user.company_id);
  db.close();
  let items = [];
  try { items = JSON.parse(o.items); } catch { }
  const itemsHtml = items.map(i => `<li>${escapeHtml(i.name)} — ${i.size ? `taille ${escapeHtml(i.size)}, ` : ''}${i.color ? escapeHtml(i.color) + ', ' : ''}qté ${i.qty} × ${i.unit_price.toLocaleString('fr-FR')} $</li>`).join('');
  res.send(layout(`Commande #${o.id}`, `
    <p><a href="/commandes">← Retour aux commandes</a></p>
    <h1>Commande #${o.id} <span class="badge badge-${o.status}">${STATUS_LABELS[o.status] || o.status}</span></h1>
    <div class="two-cols">
      <div class="form-card">
        <h2>Détails</h2>
        <p><strong>Client :</strong> ${escapeHtml(o.client_name)} (${escapeHtml(o.client_phone)})</p>
        <ul>${itemsHtml}</ul>
        <p><strong>Montant :</strong> ${o.amount.toLocaleString('fr-FR')} ${o.zone_fee ? ` <small>(dont livraison ${o.zone_fee.toLocaleString('fr-FR')} $ — ${escapeHtml(o.zone_name)})</small>` : ''}</p>
        <p><strong>Adresse :</strong> ${escapeHtml(o.address || '—')}</p>
        <p><strong>Livraison :</strong> ${o.delivery_date || '—'} · <strong>Livreur :</strong> ${escapeHtml(o.courier_name || '—')}</p>
        <p><strong>Notes :</strong> ${escapeHtml(o.notes || '—')}</p>
        <form method="post" action="/commandes/${o.id}/statut" class="row-form">
          <select name="status">${STATUS_ORDER.map(s => `<option value="${s}"${s === o.status ? ' selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select>
          <button type="submit">Mettre à jour le statut</button>
        </form>
        <form method="post" action="/commandes/${o.id}/livreur" class="row-form">
          <select name="courier_id"><option value="">—</option>${couriers.map(c => `<option value="${c.id}"${o.courier_id === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
          <button type="submit">Assigner le livreur</button>
        </form>
      </div>
      <div class="form-card">
        <h2>Historique</h2>
        <ul class="history">${history.map(h => `<li><strong>${escapeHtml(h.action)}</strong><br><small>${h.created_at}${h.user_name ? ' — ' + escapeHtml(h.user_name) : ''}</small></li>`).join('')}</ul>
      </div>
    </div>
  `, req.user, '/commandes'));
});

app.post('/commandes/:id/statut', requireBackOffice, (req, res) => {
  const db = openDb();
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND company_id=?').get(req.params.id, req.user.company_id);
  if (!o) { db.close(); return res.status(404).send('Commande introuvable.'); }
  const newStatus = req.body.status;
  if (!STATUS_LABELS[newStatus]) { db.close(); return res.status(400).send('Statut invalide.'); }
  db.prepare('UPDATE orders SET status=?, updated_at=datetime(\'now\') WHERE id=?').run(newStatus, o.id);
  db.prepare('INSERT INTO order_history (order_id, user_id, action) VALUES (?, ?, ?)').run(o.id, req.user.id, `Statut : ${STATUS_LABELS[o.status]} → ${STATUS_LABELS[newStatus]}`);
  log(req.user.company_id, req.user.id, `Commande #${o.id} : statut ${newStatus}`);
  db.close();
  res.redirect(`/commandes/${o.id}`);
});

app.post('/commandes/:id/livreur', requireBackOffice, (req, res) => {
  const db = openDb();
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND company_id=?').get(req.params.id, req.user.company_id);
  if (!o) { db.close(); return res.status(404).send('Commande introuvable.'); }
  db.prepare('UPDATE orders SET courier_id=?, updated_at=datetime(\'now\') WHERE id=?').run(req.body.courier_id || null, o.id);
  db.prepare('INSERT INTO order_history (order_id, user_id, action) VALUES (?, ?, ?)').run(o.id, req.user.id, 'Livreur assigné');
  log(req.user.company_id, req.user.id, `Commande #${o.id} : livreur assigné`);
  db.close();
  res.redirect(`/commandes/${o.id}`);
});

// --- Livraisons du lendemain ---
app.get('/livraisons', requireAuth, (req, res) => {
  const db = openDb();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const isCourier = req.user.role === 'livreur';
  const isAdmin = req.user.role === 'admin';
  let sql = `SELECT o.*, z.name AS zone_name, u.name AS courier_name, c.name AS company_name FROM orders o
    LEFT JOIN zones z ON z.id=o.zone_id LEFT JOIN users u ON u.id=o.courier_id LEFT JOIN companies c ON c.id=o.company_id
    WHERE o.delivery_date=?`;
  const args = [tomorrow];
  if (isCourier) { sql += ' AND o.courier_id=?'; args.push(req.user.id); }
  else if (!isAdmin) { sql += ' AND o.company_id=?'; args.push(req.user.company_id); }
  sql += ' ORDER BY c.name, z.name, u.name, o.status';
  const orders = db.prepare(sql).all(...args);
  db.close();
  const alerts = orders.filter(o => o.status === 'attente_confirmation' || o.status === 'attente_paiement' || o.status === 'nouvelle');
  const total = orders.filter(o => o.status !== 'annulee').reduce((s, o) => s + o.amount, 0);
  const title = isCourier ? 'Mes livraisons de demain' : 'Livraisons de demain';
  const rows = orders.map(o => `<tr><td><a href="/commandes/${o.id}">#${o.id}</a></td>${isAdmin ? `<td>${escapeHtml(o.company_name)}</td>` : ''}<td>${escapeHtml(o.client_name)}<br><small>${escapeHtml(o.client_phone)}</small></td><td>${escapeHtml(o.zone_name || '—')}</td><td>${escapeHtml(o.courier_name || '—')}</td><td>${escapeHtml(o.address || '—')}</td><td>${o.amount.toLocaleString('fr-FR')} $</td><td><span class="badge badge-${o.status}">${STATUS_LABELS[o.status]}</span></td></tr>`).join('');
  res.send(layout(title, `
    <h1>${title}</h1>
    <p class="muted">Date : ${tomorrow}${isCourier ? ' — commandes qui vous sont assignées' : ''}</p>
    ${alerts.length ? `<div class="alert">⚠️ ${alerts.length} commande(s) de demain pas encore confirmée(s) ou pas payée(s) : ${alerts.map(a => `<a href="/commandes/${a.id}">#${a.id}</a>`).join(', ')}</div>` : ''}
    <div class="cards">
      <div class="card"><div class="card-num">${orders.length}</div>Total des commandes</div>
      <div class="card"><div class="card-num">${total.toLocaleString('fr-FR')} $</div>Montant à encaisser</div>
    </div>
    <table><tr><th>N°</th>${isAdmin ? '<th>Entreprise</th>' : ''}<th>Client</th><th>Zone</th><th>Livreur</th><th>Adresse</th><th>Montant</th><th>Statut</th></tr>${rows}</table>
    ${isCourier ? '' : '<p><a class="btn" href="/livraisons?export=1">Exporter la liste (PDF)</a></p>'}
  `, req.user, '/livraisons'));
});

// --- Catalogue ---
app.get('/catalogue', requireBackOffice, (req, res) => {
  if (req.user.role === 'livreur') return res.status(403).send('Accès réservé.');
  const db = openDb();
  const products = db.prepare('SELECT * FROM products WHERE company_id=? ORDER BY name').all(req.user.company_id);
  const zones = db.prepare('SELECT * FROM zones WHERE company_id=? ORDER BY name').all(req.user.company_id);
  const variants = db.prepare('SELECT * FROM variants WHERE product_id IN (SELECT id FROM products WHERE company_id=?)').all(req.user.company_id);
  db.close();
  const prodRows = products.map(p => {
    const vs = variants.filter(v => v.product_id === p.id).map(v => `<span class="chip">${escapeHtml(v.size || '—')} / ${escapeHtml(v.color || '—')} · stock ${v.stock}</span>`).join(' ');
    return `<tr><td>${escapeHtml(p.name)}</td><td>${p.price.toLocaleString('fr-FR')} $</td><td>${escapeHtml(p.description || '')}</td><td>${vs}</td></tr>`;
  }).join('');
  const zoneRows = zones.map(z => `<tr><td>${escapeHtml(z.name)}</td><td>${z.fee.toLocaleString('fr-FR')} $</td></tr>`).join('');
  res.send(layout('Catalogue', `
    <h1>Catalogue et réglages</h1>
    <div class="two-cols">
      <div class="form-card">
        <h2>Produits</h2>
        <table><tr><th>Nom</th><th>Prix</th><th>Description</th><th>Variantes (taille / couleur · stock)</th></tr>${prodRows}</table>
        <h3>Ajouter un produit</h3>
        <form method="post" action="/catalogue/produit" class="form-card">
          <label>Nom</label><input name="name" required>
          <label>Prix ($)</label><input type="number" step="0.01" name="price" required>
          <label>Description</label><input name="description">
          <button type="submit">Ajouter</button>
        </form>
      </div>
      <div class="form-card">
        <h2>Zones de livraison</h2>
        <table><tr><th>Zone</th><th>Frais</th></tr>${zoneRows}</table>
        <h3>Ajouter une zone</h3>
        <form method="post" action="/catalogue/zone" class="form-card">
          <label>Nom de la zone</label><input name="name" required>
          <label>Frais ($)</label><input type="number" step="0.01" name="fee" value="0">
          <button type="submit">Ajouter</button>
        </form>
      </div>
    </div>
  `, req.user, '/catalogue'));
});

app.post('/catalogue/produit', requireBackOffice, (req, res) => {
  if (req.user.role === 'livreur') return res.status(403).send('Accès réservé.');
  const db = openDb();
  db.prepare('INSERT INTO products (company_id, name, price, description) VALUES (?, ?, ?, ?)')
    .run(req.user.company_id, req.body.name, parseFloat(req.body.price) || 0, req.body.description);
  log(req.user.company_id, req.user.id, `Produit ajouté : ${req.body.name}`);
  db.close();
  res.redirect('/catalogue');
});

app.post('/catalogue/zone', requireBackOffice, (req, res) => {
  if (req.user.role === 'livreur') return res.status(403).send('Accès réservé.');
  const db = openDb();
  db.prepare('INSERT INTO zones (company_id, name, fee) VALUES (?, ?, ?)')
    .run(req.user.company_id, req.body.name, parseFloat(req.body.fee) || 0);
  log(req.user.company_id, req.user.id, `Zone ajoutée : ${req.body.name}`);
  db.close();
  res.redirect('/catalogue');
});

// --- Équipe ---
app.get('/equipe', requireBackOffice, (req, res) => {
  if (req.user.role === 'livreur') return res.status(403).send('Accès réservé.');
  const db = openDb();
  const users = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE company_id=? ORDER BY name').all(req.user.company_id);
  db.close();
  const rows = users.map(u => `<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td><td>${u.role}</td><td>${u.created_at}</td></tr>`).join('');
  res.send(layout('Équipe', `
    <h1>Gestion de l'équipe</h1>
    <table><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Créé le</th></tr>${rows}</table>
    <h2>Ajouter un membre</h2>
    <form method="post" action="/equipe" class="form-card">
      <label>Nom</label><input name="name" required>
      <label>Email</label><input type="email" name="email" required>
      <label>Mot de passe</label><input type="password" name="password" required>
      <label>Rôle</label><select name="role"><option value="agent">Agent</option><option value="livreur">Livreur</option><option value="owner">Propriétaire</option></select>
      <button type="submit">Ajouter</button>
    </form>
  `, req.user, '/equipe'));
});

app.post('/equipe', requireBackOffice, (req, res) => {
  if (req.user.role === 'livreur') return res.status(403).send('Accès réservé.');
  const db = openDb();
  const { salt, hash } = hashPassword(req.body.password);
  try {
    db.prepare('INSERT INTO users (company_id, name, email, role, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.company_id, req.body.name, req.body.email, req.body.role, hash, salt);
    log(req.user.company_id, req.user.id, `Membre ajouté : ${req.body.name}`);
  } catch (e) {
    db.close();
    return res.status(400).send('Email déjà utilisé.');
  }
  db.close();
  res.redirect('/equipe');
});

// --- Espace administrateur ---
app.get('/admin', requireAdmin, (req, res) => {
  const db = openDb();
  const companies = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.company_id=c.id) AS users_count,
           (SELECT COUNT(*) FROM orders o WHERE o.company_id=c.id) AS orders_count
    FROM companies c ORDER BY c.name`).all();
  db.close();
  const rows = companies.map(c => `<tr><td>${escapeHtml(c.name)}</td><td>${c.subscription_status}</td><td>${c.subscription_plan}</td><td>${c.trial_end || '—'}</td><td>${c.users_count}</td><td>${c.orders_count}</td></tr>`).join('');
  res.send(layout('Administrateur', `
    <h1>Espace administrateur</h1>
    <p class="muted">Liste des entreprises clientes et abonnements.</p>
    <table><tr><th>Entreprise</th><th>Abonnement</th><th>Plan</th><th>Fin d'essai</th><th>Utilisateurs</th><th>Commandes</th></tr>${rows}</table>
    <h2>Ajouter une entreprise</h2>
    <form method="post" action="/admin/entreprises" class="form-card">
      <label>Nom de l'entreprise</label><input name="name" required>
      <label>Statut de l'abonnement</label>
      <select name="subscription_status"><option value="essai">Essai</option><option value="actif">Actif</option><option value="suspendu">Suspendu</option></select>
      <button type="submit">Ajouter</button>
    </form>
  `, req.user, '/admin'));
});

app.post('/admin/entreprises', requireAdmin, (req, res) => {
  const db = openDb();
  const resDb = db.prepare('INSERT INTO companies (name, subscription_status) VALUES (?, ?)').run(req.body.name, req.body.subscription_status || 'essai');
  log(resDb.lastInsertRowid, req.user.id, `Entreprise créée : ${req.body.name}`);
  db.close();
  res.redirect('/admin');
});

// --- Liens réseaux sociaux de l'entreprise (configurables par le propriétaire/admin) ---
app.get('/reseaux-sociaux', requireBackOffice, (req, res) => {
  if (req.user.role === 'livreur') return res.status(403).send('Accès réservé.');
  const db = openDb();
  const links = db.prepare('SELECT * FROM social_links WHERE company_id=?').get(req.user.company_id) || {};
  db.close();
  res.send(layout('Réseaux sociaux', `
    <h1>Liens de commande — réseaux sociaux</h1>
    <p class="muted">Ces liens sont affichés aux clients sur la boutique publique pour qu'ils commandent directement sur vos réseaux.</p>
    <form method="post" action="/reseaux-sociaux" class="form-card">
      <label>TikTok</label><input name="tiktok" value="${escapeHtml(links.tiktok || '')}" placeholder="https://www.tiktok.com/@votre-boutique">
      <label>WhatsApp</label><input name="whatsapp" value="${escapeHtml(links.whatsapp || '')}" placeholder="https://wa.me/243810000000">
      <label>Instagram</label><input name="instagram" value="${escapeHtml(links.instagram || '')}" placeholder="https://www.instagram.com/votre-boutique">
      <label>Twitter / X</label><input name="twitter" value="${escapeHtml(links.twitter || '')}" placeholder="https://twitter.com/votre-boutique">
      <button type="submit">Enregistrer</button>
    </form>
  `, req.user, '/catalogue'));
});

app.post('/reseaux-sociaux', requireBackOffice, (req, res) => {
  if (req.user.role === 'livreur') return res.status(403).send('Accès réservé.');
  const db = openDb();
  const existing = db.prepare('SELECT id FROM social_links WHERE company_id=?').get(req.user.company_id);
  if (existing) {
    db.prepare('UPDATE social_links SET tiktok=?, whatsapp=?, instagram=?, twitter=? WHERE company_id=?')
      .run(req.body.tiktok, req.body.whatsapp, req.body.instagram, req.body.twitter, req.user.company_id);
  } else {
    db.prepare('INSERT INTO social_links (company_id, tiktok, whatsapp, instagram, twitter) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.company_id, req.body.tiktok, req.body.whatsapp, req.body.instagram, req.body.twitter);
  }
  log(req.user.company_id, req.user.id, 'Mise à jour des liens réseaux sociaux');
  db.close();
  res.redirect('/reseaux-sociaux');
});

// ---------- Espace clients ----------
function clientLayout(title, body, client) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - CommandesPro</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
  <link rel="stylesheet" href="/style.css"></head><body class="auth">
  ${body}
  </body></html>`;
}

app.get('/client/login', (req, res) => {
  res.send(clientLayout('Espace client', `
    <div class="login-box">
      <h1><span>🛍️</span> Espace <b style="color:var(--primary)">Client</b></h1>
      <p class="muted">Connectez-vous pour consulter le stock des entreprises et passer vos commandes.</p>
      <form method="post" action="/client/login">
        <label>Email</label><input type="email" name="email" required>
        <label>Mot de passe</label><input type="password" name="password" required>
        <button type="submit">Se connecter</button>
      </form>
      <p style="margin-top:12px">Pas encore de compte ? <a href="/client/inscription">Créer un compte client</a></p>
      <p><a href="/login">← Espace entreprise</a></p>
    </div>`));
});

app.post('/client/login', (req, res) => {
  const db = openDb();
  db.prepare("CREATE TABLE IF NOT EXISTS client_sessions (token TEXT PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), expires_at TEXT NOT NULL)").run();
  const client = db.prepare('SELECT * FROM clients WHERE email = ?').get(req.body.email || '');
  db.close();
  if (!client || !verifyPassword(req.body.password || '', client.password_salt, client.password_hash)) {
    return res.send(clientLayout('Espace client', `<div class="login-box"><p class="error">Email ou mot de passe incorrect.</p><a href="/client/login">Réessayer</a></div>`));
  }
  const token = createClientSession(client.id);
  res.setHeader('Set-Cookie', `client=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
  res.redirect('/client/boutique');
});

app.get('/client/inscription', (req, res) => {
  res.send(clientLayout('Inscription client', `
    <div class="login-box">
      <h1><span>🛍️</span> Créer un compte <b style="color:var(--primary)">Client</b></h1>
      <form method="post" action="/client/inscription">
        <label>Nom complet</label><input name="name" required>
        <label>Email</label><input type="email" name="email" required>
        <label>Téléphone</label><input name="phone" required placeholder="+243 …">
        <label>Mot de passe</label><input type="password" name="password" required>
        <button type="submit">Créer mon compte</button>
      </form>
      <p style="margin-top:12px"><a href="/client/login">← Retour à la connexion</a></p>
    </div>`));
});

app.post('/client/inscription', (req, res) => {
  const db = openDb();
  const { salt, hash } = hashPassword(req.body.password || '');
  try {
    db.prepare('INSERT INTO clients (name, email, phone, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)')
      .run(req.body.name, req.body.email, req.body.phone, hash, salt);
  } catch (e) {
    db.close();
    return res.send(clientLayout('Inscription client', `<div class="login-box"><p class="error">Cet email est déjà utilisé.</p><a href="/client/inscription">Réessayer</a></div>`));
  }
  db.close();
  res.redirect('/client/login');
});

app.get('/client/logout', (req, res) => {
  const token = (req.headers.cookie || '').match(/client=([a-f0-9]+)/);
  if (token) clientLogout(token[1]);
  res.setHeader('Set-Cookie', 'client=; Path=/; Max-Age=0');
  res.redirect('/client/login');
});

// Boutique publique : stock de toutes les entreprises + liens de commande sur réseaux sociaux
app.get('/client/boutique', requireClient, (req, res) => {
  const db = openDb();
  const companies = db.prepare('SELECT * FROM companies ORDER BY name').all();
  const products = db.prepare('SELECT * FROM products WHERE active=1 ORDER BY company_id, name').all();
  const variants = db.prepare('SELECT * FROM variants').all();
  const zones = db.prepare('SELECT * FROM zones ORDER BY company_id, name').all();
  const links = db.prepare('SELECT * FROM social_links').all();
  db.close();
  const socialIcons = {
    tiktok: ['🎵', 'TikTok'], whatsapp: ['💬', 'WhatsApp'], instagram: ['📸', 'Instagram'], twitter: ['🐦', 'Twitter / X'],
  };
  const cards = companies.map(c => {
    const prods = products.filter(p => p.company_id === c.id);
    if (!prods.length) return '';
    const sl = links.find(l => l.company_id === c.id) || {};
    const socials = ['tiktok', 'whatsapp', 'instagram', 'twitter'].filter(k => sl[k])
      .map(k => `<a class="btn social-btn social-${k}" href="${escapeHtml(sl[k])}" target="_blank" rel="noopener">${socialIcons[k][0]} Commander sur ${socialIcons[k][1]}</a>`).join(' ');
    const prodHtml = prods.map(p => {
      const vs = variants.filter(v => v.product_id === p.id);
      const stockTotal = vs.reduce((s, v) => s + v.stock, 0);
      return `<tr><td>${escapeHtml(p.name)}</td><td>${p.price.toLocaleString('fr-FR')} $</td><td>${escapeHtml(p.description || '')}</td><td>${vs.map(v => `<span class="chip">${escapeHtml(v.size || '—')} / ${escapeHtml(v.color || '—')} · ${v.stock} en stock</span>`).join(' ') || (stockTotal ? '' : '<em>Stock non détaillé</em>')}</td></tr>`;
    }).join('');
    const zonesHtml = zones.filter(z => z.company_id === c.id).map(z => `<option value="${z.id}">${escapeHtml(z.name)} (${z.fee.toLocaleString('fr-FR')} $)</option>`).join('');
    return `
      <div class="form-card">
        <h2>🏬 ${escapeHtml(c.name)}</h2>
        <table><tr><th>Produit</th><th>Prix</th><th>Description</th><th>Stock</th></tr>${prodHtml}</table>
        <h3>Passer une commande interne</h3>
        <form method="post" action="/client/commande" class="form-card">
          <input type="hidden" name="company_id" value="${c.id}">
          <label>Produit</label><select name="product_id" required>${prods.map(p => `<option value="${p.id}">${escapeHtml(p.name)} — ${p.price.toLocaleString('fr-FR')} $</option>`).join('')}</select>
          <div class="row">
            <div><label>Quantité</label><input type="number" name="qty" value="1" min="1" required></div>
            <div><label>Zone de livraison</label><select name="zone_id">${zonesHtml}</select></div>
          </div>
          <label>Adresse de livraison</label><input name="address" required placeholder="Avenue, n°, repère…">
          <label>Date de livraison souhaitée</label><input type="date" name="delivery_date">
          <label>Notes</label><textarea name="notes" rows="2"></textarea>
          <button type="submit">Envoyer ma commande</button>
        </form>
        ${socials ? `<h3>Commander directement sur les réseaux</h3><div class="social-row">${socials}</div>` : '<p class="muted">Cette entreprise n’a pas encore partagé de liens de commande (TikTok, WhatsApp, Instagram, Twitter).</p>'}
      </div>`;
  }).join('');
  res.send(clientLayout('Boutique — Stock des entreprises', `
    <div style="max-width:1100px;margin:0 auto;padding:24px">
      <h1>🛍️ Bonjour ${escapeHtml(req.client.name)}, voici le stock des entreprises</h1>
      <p class="muted">Choisissez une entreprise, consultez son stock et commandez ici ou directement sur TikTok, WhatsApp, Instagram ou Twitter.</p>
      ${cards}
      <p><a href="/client/logout">Se déconnecter</a></p>
    </div>`));
});

// Commande envoyée par un client : enregistrée dans la commande de l'entreprise concernée
app.post('/client/commande', requireClient, (req, res) => {
  const db = openDb();
  const companyId = parseInt(req.body.company_id, 10);
  const product = db.prepare('SELECT * FROM products WHERE id=? AND company_id=? AND active=1').get(req.body.product_id, companyId);
  if (!product) { db.close(); return res.status(400).send('Produit introuvable.'); }
  const qty = Math.max(1, parseInt(req.body.qty || '1', 10));
  const zone = db.prepare('SELECT * FROM zones WHERE id=? AND company_id=?').get(req.body.zone_id, companyId);
  const amount = product.price * qty + (zone ? zone.fee : 0);
  const items = JSON.stringify([{ product_id: product.id, name: product.name, qty, unit_price: product.price }]);
  const resDb = db.prepare(`INSERT INTO orders (company_id, client_name, client_phone, items, amount, zone_id, address, delivery_date, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'nouvelle', ?)`)
    .run(companyId, req.client.name, req.client.phone || '', items, amount, req.body.zone_id || null, req.body.address, req.body.delivery_date || null, req.body.notes || '');
  db.prepare('INSERT INTO order_history (order_id, user_id, action) VALUES (?, NULL, ?)').run(resDb.lastInsertRowid, `Commande passée en ligne par le client ${req.client.name}`);
  db.close();
  res.send(clientLayout('Commande envoyée', `
    <div class="login-box">
      <h1>✅ Commande envoyée !</h1>
      <p>Votre commande <strong>#${resDb.lastInsertRowid}</strong> a été transmise à l'entreprise. Elle vous contactera pour la confirmation et le paiement.</p>
      <p><a class="btn" href="/client/boutique">← Retour à la boutique</a></p>
    </div>`));
});

// ---------- Démarrage ----------
app.listen(PORT, () => {
  console.log(`✅ Application démarrée : http://localhost:${PORT}`);
});
