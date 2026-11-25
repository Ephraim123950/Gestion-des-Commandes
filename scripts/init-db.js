// Données de démonstration pour les entreprises pilotes
const { openDb, initDb, hashPassword } = require('../db');

function seed() {
  initDb();
  const db = openDb();
  // Réinitialisation propre (données de démonstration)
  db.exec('PRAGMA foreign_keys = OFF; DELETE FROM order_history; DELETE FROM orders; DELETE FROM variants; DELETE FROM products; DELETE FROM zones; DELETE FROM users; DELETE FROM companies; DELETE FROM sessions; DELETE FROM action_log; PRAGMA foreign_keys = ON;');

  const companies = [
    { name: 'Boutique Élégance', trial_end: '2026-12-21' },
    { name: 'Kin Fashion Store', trial_end: '2026-12-21' },
    { name: 'TechPhone RDC', trial_end: '2027-01-24' },
    { name: 'Saveurs du Plateau', trial_end: '2027-01-24' },
    { name: 'Accessoires Kin', trial_end: null },
  ];

  const companyIds = [];
  for (const c of companies) {
    const res = db.prepare('INSERT INTO companies (name, subscription_status, trial_end) VALUES (?, ?, ?)').run(c.name, 'essai', c.trial_end);
    companyIds.push(res.lastInsertRowid);
  }

  // Utilisateurs
  const users = [
    { company: 0, name: 'Administrateur', email: 'admin@demo.cd', role: 'admin', password: 'admin123' },
    { company: 0, name: 'Marie Kabila', email: 'marie@elegance.cd', role: 'owner', password: 'marie123' },
    { company: 0, name: 'Jean agent', email: 'jean@elegance.cd', role: 'agent', password: 'jean123' },
    { company: 0, name: 'Patrick livreur', email: 'patrick@elegance.cd', role: 'livreur', password: 'patrick123' },
    { company: 1, name: 'Sola Mbala', email: 'sola@kinfashion.cd', role: 'owner', password: 'sola123' },
    { company: 1, name: 'Divine livreur', email: 'divine@kinfashion.cd', role: 'livreur', password: 'divine123' },
    { company: 2, name: 'Didier Mulumba', email: 'didier@techphone.cd', role: 'owner', password: 'didier123' },
    { company: 2, name: 'Christian livreur', email: 'christian@techphone.cd', role: 'livreur', password: 'christian123' },
    { company: 3, name: 'Aline Tshibangu', email: 'aline@saveurs.cd', role: 'owner', password: 'aline123' },
    { company: 3, name: 'Emmanuel livreur', email: 'emmanuel@saveurs.cd', role: 'livreur', password: 'emmanuel123' },
    { company: 4, name: 'Yannick Bope', email: 'yannick@accessoires.cd', role: 'owner', password: 'yannick123' },
    { company: 4, name: 'Rachel livreur', email: 'rachel@accessoires.cd', role: 'livreur', password: 'rachel123' },
  ];
  const userIds = {};
  for (const u of users) {
    const { salt, hash } = hashPassword(u.password);
    const res = db.prepare('INSERT INTO users (company_id, name, email, role, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(companyIds[u.company], u.name, u.email, u.role, hash, salt);
    userIds[u.email] = res.lastInsertRowid;
  }

  // Zones de livraison
  const zonesData = [
    [0, 'Gombe', 3], [0, 'Kinshasa centre', 2], [0, 'Lingwala', 5], [0, 'Limete', 4],
    [1, 'Gombe', 3], [1, 'Kintambo', 4], [1, 'Ngaliema', 5],
    [2, 'Gombe', 3], [2, 'Limete', 4], [2, 'Masina', 6],
    [3, 'Gombe', 3], [3, 'Bandalungwa', 4], [3, 'Kintambo', 4],
    [4, 'Kinshasa centre', 2], [4, 'Ngaliema', 5],
  ];
  const zoneIds = {};
  for (const [ci, name, fee] of zonesData) {
    const res = db.prepare('INSERT INTO zones (company_id, name, fee) VALUES (?, ?, ?)').run(companyIds[ci], name, fee);
    zoneIds[ci + ':' + name] = res.lastInsertRowid;
  }

  // Produits et variantes
  const productsData = [
    {
      company: 0, name: 'Robe noire classique', price: 25, description: 'Robe élégante, tissu satiné',
      variants: [['S', 'Noir', 5], ['M', 'Noir', 8], ['L', 'Noir', 3], ['M', 'Rouge', 2]],
    },
    {
      company: 0, name: 'Pochette cuir', price: 15, description: 'Pochette cuir véritable, fermeture zip',
      variants: [['Taille unique', 'Marron', 10], ['Taille unique', 'Noir', 6]],
    },
    {
      company: 1, name: 'Ensemble sport homme', price: 30, description: 'Ensemble survêtement, coton épais',
      variants: [['M', 'Gris', 4], ['L', 'Gris', 7], ['XL', 'Bleu', 2]],
    },
    {
      company: 1, name: 'Sandales femme', price: 12, description: 'Sandales à talon, plusieurs tailles',
      variants: [['37', 'Beige', 5], ['38', 'Beige', 3], ['39', 'Noir', 4]],
    },
    {
      company: 2, name: 'Smartphone Galaxy A15', price: 180, description: 'Écran 6,5 pouces, 128 Go, double SIM',
      variants: [['Standard', 'Noir', 6], ['Standard', 'Bleu', 4]],
    },
    {
      company: 2, name: 'Chargeur rapide 33W', price: 10, description: 'Chargeur mural USB-C, livraison rapide',
      variants: [['Standard', 'Blanc', 20]],
    },
    {
      company: 3, name: 'Menu complet du jour', price: 8, description: 'Plat, accompagnement et boisson',
      variants: [['Standard', '—', 40]],
    },
    {
      company: 3, name: 'Jus naturel ananas', price: 2, description: 'Jus frais pressé, 50 cl',
      variants: [['50 cl', '—', 30]],
    },
    {
      company: 4, name: 'Écouteurs Bluetooth', price: 18, description: 'Sans fil, autonomie 6h',
      variants: [['Standard', 'Noir', 12], ['Standard', 'Blanc', 8]],
    },
    {
      company: 4, name: 'Coque téléphone', price: 5, description: 'Coque silicone souple',
      variants: [['Standard', 'Noir', 25], ['Standard', 'Rose', 15]],
    },
  ];
  const productIds = [];
  for (const p of productsData) {
    const res = db.prepare('INSERT INTO products (company_id, name, price, description) VALUES (?, ?, ?, ?)')
      .run(companyIds[p.company], p.name, p.price, p.description);
    const pid = res.lastInsertRowid;
    productIds.push(pid);
    for (const [size, color, stock] of p.variants) {
      db.prepare('INSERT INTO variants (product_id, size, color, stock) VALUES (?, ?, ?, ?)').run(pid, size, color, stock);
    }
  }

  // Commandes de démonstration (dates : aujourd'hui, demain, après-demain)
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const dayAfter = new Date(today); dayAfter.setDate(today.getDate() + 2);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

  const ordersData = [
    // [company, client, phone, items, zone, adresse, date, livreur, statut, notes, montant]
    [0, 'Nadine Tshiala', '+243 810 111 222', [{ product_id: productIds[0], name: 'Robe noire classique', size: 'M', color: 'Noir', qty: 1, unit_price: 25 }], 'Gombe', 'Av. Kasa-Vubu 12, Gombe', iso(tomorrow), 'patrick@elegance.cd', 'confirmée', 'Livrer avant 12h', 28],
    [0, 'Chadrack Mbu', '+243 820 333 444', [{ product_id: productIds[1], name: 'Pochette cuir', size: 'Taille unique', color: 'Marron', qty: 2, unit_price: 15 }], 'Limete', 'Av. Kabambare 5, Limete', iso(tomorrow), 'patrick@elegance.cd', 'en préparation', '', 34],
    [0, 'Grâce Mwamba', '+243 890 555 666', [{ product_id: productIds[0], name: 'Robe noire classique', size: 'L', color: 'Noir', qty: 1, unit_price: 25 }], 'Lingwala', 'Av. Lukusa 8, Lingwala', iso(today), null, 'en attente de paiement', 'Client va payer par Mobile Money', 30],
    [0, 'Fabrice Ilunga', '+243 850 777 888', [{ product_id: productIds[1], name: 'Pochette cuir', size: 'Taille unique', color: 'Noir', qty: 1, unit_price: 15 }], 'Kinshasa centre', 'Bd du 30 Juin 45', iso(tomorrow), null, 'en attente de confirmation', '', 17],
    [0, 'Béatrice Lolo', '+243 899 000 111', [{ product_id: productIds[0], name: 'Robe noire classique', size: 'S', color: 'Noir', qty: 1, unit_price: 25 }], 'Gombe', 'Av. Pumbu 22, Gombe', iso(yesterday), 'patrick@elegance.cd', 'livrée', '', 28],
    [1, 'Espérance Kalala', '+243 811 222 333', [{ product_id: productIds[2], name: 'Ensemble sport homme', size: 'L', color: 'Gris', qty: 1, unit_price: 30 }], 'Ngaliema', 'Av. Colonel Mondjiba 88, Ngaliema', iso(tomorrow), 'divine@kinfashion.cd', 'confirmée', '', 35],
    [1, 'Trésor Nkosi', '+243 822 444 555', [{ product_id: productIds[3], name: 'Sandales femme', size: '38', color: 'Beige', qty: 1, unit_price: 12 }], 'Kintambo', 'Av. Mombele 14, Kintambo', iso(tomorrow), null, 'nouvelle', '', 16],
    [1, 'Ruth Beya', '+243 833 666 777', [{ product_id: productIds[2], name: 'Ensemble sport homme', size: 'XL', color: 'Bleu', qty: 1, unit_price: 30 }], 'Gombe', 'Av. de la Justice 3, Gombe', iso(dayAfter), null, 'en attente de confirmation', '', 35],
    [2, 'Papy Kasongo', '+243 844 111 999', [{ product_id: productIds[4], name: 'Smartphone Galaxy A15', size: 'Standard', color: 'Noir', qty: 1, unit_price: 180 }], 'Gombe', 'Av. du Port 7, Gombe', iso(tomorrow), 'christian@techphone.cd', 'confirmée', 'Payer à la livraison', 183],
    [2, 'Mireille Kapend', '+243 855 222 000', [{ product_id: productIds[5], name: 'Chargeur rapide 33W', size: 'Standard', color: 'Blanc', qty: 2, unit_price: 10 }], 'Limete', 'Av. Pierre Mulele 21, Limete', iso(tomorrow), null, 'nouvelle', '', 24],
    [3, 'Joseph Mwepu', '+243 866 333 111', [{ product_id: productIds[6], name: 'Menu complet du jour', size: 'Standard', color: '—', qty: 3, unit_price: 8 }], 'Bandalungwa', 'Av. Fond Belleville 9, Bandal', iso(tomorrow), 'emmanuel@saveurs.cd', 'confirmée', 'Livrer midi', 28],
    [3, 'Clarisse Ngoy', '+243 877 444 222', [{ product_id: productIds[7], name: 'Jus naturel ananas', size: '50 cl', color: '—', qty: 4, unit_price: 2 }], 'Kintambo', 'Av. Mfuti 12, Kintambo', iso(today), null, 'en attente de confirmation', '', 12],
    [4, 'Guy Mutombo', '+243 888 555 333', [{ product_id: productIds[8], name: 'Écouteurs Bluetooth', size: 'Standard', color: 'Noir', qty: 1, unit_price: 18 }], 'Kinshasa centre', 'Bd du 30 Juin 101', iso(tomorrow), null, 'en préparation', '', 20],
    [4, 'Sarah Ilunga', '+243 899 666 444', [{ product_id: productIds[9], name: 'Coque téléphone', size: 'Standard', color: 'Rose', qty: 1, unit_price: 5 }], 'Ngaliema', 'Av. Sukola 3, Ngaliema', iso(tomorrow), 'rachel@accessoires.cd', 'confirmée', '', 10],
  ];
  for (const [ci, client, phone, items, zone, address, date, courier, status, notes, amount] of ordersData) {
    const res = db.prepare(`INSERT INTO orders (company_id, client_name, client_phone, items, amount, zone_id, address, delivery_date, courier_id, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(companyIds[ci], client, phone, JSON.stringify(items), amount, zoneIds[ci + ':' + zone], address, date, courier ? userIds[courier] : null, status, notes);
    db.prepare('INSERT INTO order_history (order_id, user_id, action) VALUES (?, NULL, ?)').run(res.lastInsertRowid, 'Commande créée (données de démonstration)');
  }

  db.close();
  console.log('Base de données initialisée avec des données de démonstration.');
}

seed();
