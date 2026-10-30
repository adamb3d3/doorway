/* The Doorway v3 — case catalog, facility profile, seeded RNG, case selection.
 * Plain JS (Safari 15 safe: no modules, no ??=, no top-level await).
 * Defines window.DW_CASES. Loads in Node too (assigns to globalThis when no window).
 */
(function (root) {
  "use strict";

  // ── Facility profile (placeholders — Derek will correct) ──────────────────
  var FACILITY = {
    name: "Critical access hospital",
    beds: 25, icu: false, surgery: false, cathLab: false, neurosurgery: false, ir: false,
    ctHours: [7, 19], // CT staffed 07:00–19:00; outside: CT unavailable unless in-house or on-call tech
    timesMin: {
      history: 2, exam: 2, bedside: 5, labsPoc: 15,
      labsSend: 45, xray: 20, ct: 35,
      procedure: 10, stabilize: 5, bloodBank: 20, callReceiving: 15,
      groundTransfer: 70, flightTransfer: 35
    },
    obNegUnitsDefault: 2
  };

  var DOMAINS = ["Resuscitation", "Airway", "Vascular access", "Trauma", "Pediatrics", "OB", "Cardiac",
    "Ventilation", "POCUS", "Transfer", "Neuro", "Tox/Environmental", "Medical", "Minor care"];

  // v2 age mix: infants 5, children 15, adolescents 5, adults 50, elderly 15, very elderly/NH 10.
  var AGE_BANDS = {
    infant: { min: 0.05, max: 0.95, weight: 5, label: "Infant (<1 y)" },
    child: { min: 1, max: 12, weight: 15, label: "Child (1–12 y)" },
    adolescent: { min: 13, max: 17, weight: 5, label: "Adolescent (13–17 y)" },
    adult: { min: 18, max: 64, weight: 50, label: "Adult (18–64 y)" },
    elderly: { min: 65, max: 84, weight: 15, label: "Elderly (65–84 y)" },
    nh: { min: 85, max: 99, weight: 10, label: "Very elderly / nursing home (85+)" }
  };
  var BAND_ORDER = ["infant", "child", "adolescent", "adult", "elderly", "nh"];

  // v2 demographic mix and Fitzpatrick mapping (Black/African American minimum 5).
  var ETHNICITIES = [
    { name: "White", weight: 75, fitz: [1, 3] },
    { name: "Hispanic/Latino", weight: 10, fitz: [3, 4] },
    { name: "Black/African American", weight: 8, fitz: [5, 6] },
    { name: "Native American", weight: 3, fitz: [3, 5] },
    { name: "East Asian", weight: 1, fitz: [2, 4] },
    { name: "South Asian", weight: 1, fitz: [4, 5] },
    { name: "Middle Eastern", weight: 2, fitz: [3, 4] }
  ];

  // ── Seeded RNG ────────────────────────────────────────────────────────────
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rint(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }
  function pickOne(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function pickWeighted(rng, items, wfn) {
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += Math.max(0, wfn(items[i]));
    if (total <= 0) return items[Math.floor(rng() * items.length)];
    var r = rng() * total;
    for (i = 0; i < items.length; i++) {
      r -= Math.max(0, wfn(items[i]));
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // ── Catalog ───────────────────────────────────────────────────────────────
  // E(id, dx, domain, bucket, ages, presentations, lookalikes, opts)
  // ages: space-separated band names. opts: {sex, cantMiss, ageRange:[min,max]}
  var CATALOG = [];
  function E(id, dx, domain, bucket, ages, presentations, lookalikes, opts) {
    opts = opts || {};
    var e = {
      id: id, dx: dx, domain: domain, bucket: bucket,
      ages: ages.split(" "),
      presentations: presentations,
      cantMiss: opts.cantMiss === undefined ? bucket === "serious" : !!opts.cantMiss,
      lookalikes: lookalikes
    };
    if (opts.sex) e.sex = opts.sex;
    if (opts.ageRange) e.ageRange = opts.ageRange;
    CATALOG.push(e);
  }
  var B = "benign", S = "serious";

  // Benign — urgent-care level (v2)
  E("uri", "Viral upper respiratory infection", "Minor care", B, "child adolescent adult elderly", ["typical", "worried it's pneumonia", "wants antibiotics"], ["strep_pharyngitis", "sinusitis", "pneumonia_cap", "co_poisoning"]);
  E("viral_pharyngitis", "Viral pharyngitis", "Minor care", B, "child adolescent adult", ["typical", "demanding antibiotics"], ["strep_pharyngitis", "pta", "epiglottitis_adult"]);
  E("strep_pharyngitis", "Streptococcal pharyngitis", "Minor care", B, "child adolescent adult", ["typical", "child with abdominal pain and fever"], ["viral_pharyngitis", "pta", "epiglottitis_child"]);
  E("otitis_media", "Acute otitis media", "Pediatrics", B, "infant child", ["typical", "fever and fussiness, pulling at ear"], ["viral_fever_toddler", "bacterial_meningitis"]);
  E("sinusitis", "Acute sinusitis", "Minor care", B, "adolescent adult elderly", ["typical", "upper tooth pain"], ["uri", "dental_pain", "temporal_arteritis"]);
  E("bronchitis", "Acute bronchitis", "Minor care", B, "adolescent adult elderly", ["typical", "three-week lingering cough"], ["pneumonia_cap", "copd_bipap", "pe_stable"]);
  E("cystitis", "Uncomplicated cystitis", "Minor care", B, "adolescent adult", ["typical", "mild low back ache"], ["pyelonephritis", "ectopic_ruptured", "sti_cervicitis"], { sex: "F" });
  E("vaginal_discharge", "Vaginitis (bacterial vaginosis or candida)", "Minor care", B, "adolescent adult", ["typical", "worried about an STI"], ["sti_cervicitis", "ectopic_ruptured"], { sex: "F" });
  E("sti_cervicitis", "Chlamydia/gonorrhea infection", "Minor care", B, "adolescent adult", ["discharge and dysuria", "requesting screening after exposure"], ["cystitis", "vaginal_discharge", "testicular_torsion"]);
  E("ankle_sprain", "Ankle sprain", "Minor care", B, "child adolescent adult", ["inversion on stairs", "basketball, can't bear weight at first"], ["contusion", "dvt"]);
  E("wrist_sprain", "Wrist sprain vs occult scaphoid fracture", "Minor care", B, "adolescent adult", ["fall on outstretched hand", "snuffbox tenderness, normal film"], ["contusion"]);
  E("laceration", "Simple laceration", "Minor care", B, "child adolescent adult elderly", ["kitchen knife to hand", "fence wire on the farm"], []);
  E("burn_simple", "Superficial partial-thickness burn", "Minor care", B, "child adolescent adult", ["scald from a pot", "grease splash"], ["laceration", "nat", "burn_major"]);
  E("back_pain_mech", "Mechanical low back pain (no red flags)", "Minor care", B, "adult elderly", ["lifting feed sacks", "chronic flare"], ["cauda_equina", "aortic_dissection", "aaa_rupture", "pyelonephritis"]);
  E("tension_headache", "Tension-type headache", "Neuro", B, "adolescent adult", ["typical end-of-week headache", "stress at work"], ["sah", "migraine", "co_poisoning", "temporal_arteritis"]);
  E("migraine", "Migraine", "Neuro", B, "adolescent adult", ["with visual aura", "'worst one yet' but typical pattern"], ["sah", "stroke_tnk", "tension_headache"]);
  E("contact_derm", "Contact dermatitis", "Minor care", B, "child adolescent adult", ["poison ivy after clearing brush", "new detergent"], ["cellulitis", "urticaria"]);
  E("urticaria", "Mild allergic reaction (urticaria)", "Minor care", B, "child adolescent adult", ["hives on a new antibiotic", "hives after a meal"], ["anaphylaxis", "angioedema_ace"]);
  E("tick_bite", "Tick bite / early localized Lyme disease", "Minor care", B, "child adolescent adult", ["tick still attached", "expanding target rash"], ["cellulitis", "contact_derm"]);
  E("dental_pain", "Dental pain (caries / periapical abscess)", "Minor care", B, "adolescent adult", ["typical", "third visit this month"], ["ludwig_angina", "sinusitis", "stemi_lytics"]);
  E("med_refill", "Medication refill request", "Minor care", B, "adult elderly", ["ran out of blood pressure pills", "ran out of inhaler"], ["copd_bipap", "alcohol_withdrawal"]);
  E("wound_recheck", "Wound recheck", "Minor care", B, "child adult elderly", ["routine suture check", "worried about redness"], ["cellulitis", "nec_fasc"]);
  E("fb_ear_nose", "Foreign body in ear or nose", "Pediatrics", B, "child", ["bead in nose", "bug in ear"], ["fb_aspiration", "otitis_media"]);
  E("splinter", "Retained splinter or fishhook", "Minor care", B, "child adolescent adult", ["wood splinter", "fishhook in thumb"], ["laceration", "cellulitis"]);
  E("constipation", "Constipation", "Medical", B, "child adult elderly", ["child with crampy belly pain", "on opioids"], ["appendicitis", "intussusception", "sbo"]);
  E("gastroenteritis", "Viral gastroenteritis", "Medical", B, "child adolescent adult elderly", ["typical", "whole household sick"], ["appendicitis", "dka_adult", "mesenteric_ischemia", "stemi_lytics"]);
  E("gerd", "GERD / dyspepsia", "Medical", B, "adult elderly", ["burning after meals", "worse lying down"], ["nstemi", "stemi_lytics", "biliary_colic"]);
  E("contusion", "Contusion", "Minor care", B, "child adolescent adult elderly", ["fall from a ladder rung", "sports collision"], ["blunt_mvc_spleen", "ankle_sprain"]);

  // Benign — pediatric non-emergent (v2)
  E("viral_fever_toddler", "Viral febrile illness (toddler)", "Pediatrics", B, "infant child", ["typical", "high fever, frightened parents"], ["peds_septic_shock", "bacterial_meningitis", "otitis_media"]);
  E("croup_mild", "Mild croup", "Pediatrics", B, "infant child", ["barky cough at 2 AM"], ["epiglottitis_child", "fb_aspiration"]);
  E("minor_head_injury", "Minor head injury (low risk)", "Pediatrics", B, "infant child adolescent", ["rolled off the couch", "head bump at practice"], ["nat", "epidural_hematoma"]);
  E("viral_exanthem", "Viral exanthem", "Pediatrics", B, "infant child", ["roseola after three days of fever", "hand-foot-mouth"], ["bacterial_meningitis", "urticaria"]);
  E("infant_feeding", "Normal infant / physiologic reflux (feeding concern)", "Pediatrics", B, "infant", ["spits up after every feed", "new parents worried"], ["nat", "infant_gastro", "rsv_apnea"]);
  E("infant_gastro", "Gastroenteritis with mild dehydration", "Pediatrics", B, "infant child", ["vomiting and diarrhea for a day"], ["intussusception", "peds_dka", "peds_septic_shock"]);
  E("febrile_seizure", "Simple febrile seizure", "Pediatrics", B, "infant child", ["seized at home, now playful"], ["bacterial_meningitis", "status_epilepticus_peds"], { ageRange: [0.5, 5] });
  E("nursemaid", "Radial head subluxation (nursemaid's elbow)", "Pediatrics", B, "child", ["won't use arm after being swung"], ["nat", "contusion"], { ageRange: [1, 5] });
  E("bronchiolitis_mild", "Mild bronchiolitis", "Pediatrics", B, "infant", ["congested, still feeding"], ["rsv_apnea", "croup_mild"]);
  E("asthma_mild", "Mild asthma exacerbation", "Medical", B, "child adolescent adult", ["ran out of inhaler", "after a cold"], ["status_asthmaticus", "fb_aspiration", "anaphylaxis"]);

  // Benign — geriatric non-emergent (v2)
  E("bppv", "Benign paroxysmal positional vertigo", "Neuro", B, "adult elderly", ["room spins when rolling over"], ["stroke_posterior", "stroke_tnk"]);
  E("oa_flare", "Chronic pain flare (osteoarthritis)", "Minor care", B, "elderly nh", ["knee flare", "hip flare"], ["hip_fracture", "dvt"]);
  E("med_side_effect", "Medication side effect", "Medical", B, "elderly nh", ["dizzy on a new BP pill", "constipated on a new opioid"], ["complete_heart_block", "hyperkalemia_dialysis", "vasovagal_syncope"]);
  E("deconditioning", "Deconditioning / generalized weakness", "Medical", B, "elderly nh", ["can't get out of the chair", "daughter worried"], ["septic_shock_nh", "hyperkalemia_dialysis", "nstemi", "stroke_tnk"]);

  // Benign — stable nursing home transfers (v2)
  E("nh_uti_ams", "Altered mental status from UTI (stable)", "Medical", B, "elderly nh", ["more confused per staff"], ["septic_shock_nh", "elderly_sdh"]);
  E("nh_dehydration", "Altered mental status from dehydration", "Medical", B, "elderly nh", ["poor intake for a week"], ["hyponatremia_seizure", "septic_shock_nh"]);
  E("fecal_impaction", "Fecal impaction", "Medical", B, "elderly nh", ["overflow diarrhea", "agitation"], ["sbo", "mesenteric_ischemia"]);
  E("polypharmacy", "Medication reconciliation / polypharmacy", "Medical", B, "nh", ["sent in for a med review after a near-fall"], ["med_side_effect", "hyperkalemia_dialysis"]);
  E("nh_fall_nofx", "Fall without fracture", "Minor care", B, "elderly nh", ["found on the floor at night"], ["hip_fracture", "elderly_sdh"]);
  E("pressure_injury", "Pressure injury / skin breakdown", "Minor care", B, "nh", ["sacral wound"], ["nec_fasc", "septic_shock_nh"]);
  E("peg_dislodged", "Dislodged PEG tube", "Minor care", B, "nh", ["tube came out overnight"], []);
  E("foley_blocked", "Blocked indwelling catheter", "Minor care", B, "elderly nh", ["no output, suprapubic pain"], ["nh_uti_ams", "septic_shock_nh"]);
  E("goals_of_care", "Declining patient — family-requested evaluation (goals of care)", "Medical", B, "nh", ["family wants everything done", "hospice question"], ["septic_shock_nh", "deconditioning"]);

  // Benign — additions (common mimics of serious entries)
  E("renal_colic", "Renal colic", "Medical", B, "adult", ["typical writhing flank pain"], ["aaa_rupture", "pyelonephritis", "testicular_torsion", "appendicitis"]);
  E("biliary_colic", "Biliary colic", "Medical", B, "adult", ["RUQ pain after a fatty meal"], ["nstemi", "gerd", "severe_preeclampsia"]);
  E("pneumonia_cap", "Community-acquired pneumonia (outpatient-appropriate)", "Medical", B, "adult elderly", ["typical", "elderly with only fatigue"], ["septic_shock_nh", "pe_stable", "chf_scape"]);
  E("pyelonephritis", "Pyelonephritis (outpatient-appropriate)", "Medical", B, "adolescent adult", ["fever and flank pain"], ["septic_shock_nh", "renal_colic", "ectopic_ruptured"], { sex: "F" });
  E("cellulitis", "Cellulitis", "Minor care", B, "adult elderly", ["red warm shin"], ["nec_fasc", "dvt"]);
  E("panic_attack", "Panic attack", "Medical", B, "adolescent adult", ["chest tightness and tingling hands"], ["pe_stable", "massive_pe", "svt", "dka_adult"]);
  E("costochondritis", "Musculoskeletal chest wall pain", "Minor care", B, "adolescent adult", ["reproducible chest pain after lifting"], ["nstemi", "aortic_dissection", "pe_stable"]);
  E("epistaxis", "Anterior epistaxis", "Minor care", B, "adult elderly", ["on aspirin, dry winter air"], ["gi_bleed_anticoag"]);
  E("vasovagal_syncope", "Vasovagal syncope", "Medical", B, "adolescent adult", ["fainted during a blood draw", "standing in church"], ["ectopic_ruptured", "complete_heart_block", "pe_stable", "aortic_dissection"]);
  E("etoh_intox", "Alcohol intoxication, uncomplicated", "Tox/Environmental", B, "adult", ["brought in by deputies"], ["epidural_hematoma", "hypoglycemia_insulin", "alcohol_withdrawal"]);
  E("bee_sting_local", "Large local reaction to bee sting", "Minor care", B, "child adult", ["swollen hand"], ["anaphylaxis", "cellulitis"]);
  E("hypoglycemia_insulin", "Insulin-related hypoglycemia, resolved", "Medical", B, "adult elderly", ["found confused by spouse, better after juice"], ["stroke_tnk", "etoh_intox"]);
  E("pta", "Peritonsillar abscess", "Airway", B, "adolescent adult", ["hot-potato voice, trismus"], ["strep_pharyngitis", "epiglottitis_adult", "ludwig_angina"]);
  E("dvt", "Deep vein thrombosis (outpatient-appropriate)", "Medical", B, "adult elderly", ["swollen calf after a long drive"], ["cellulitis", "pe_stable"], { cantMiss: true });
  E("spont_ptx_small", "Small primary spontaneous pneumothorax", "POCUS", B, "adolescent adult", ["tall thin young man with sudden pleuritic pain"], ["tension_ptx", "costochondritis", "panic_attack"], { sex: "M", ageRange: [15, 35] });

  // Serious — resuscitation (v2)
  E("septic_shock_nh", "Septic shock (nursing home)", "Resuscitation", S, "elderly nh", ["near-normal BP early, subtle confusion", "hypothermic and quiet", "urosepsis with a Foley"], ["nh_uti_ams", "nh_dehydration", "deconditioning"]);
  E("cardiogenic_shock_stemi", "Cardiogenic shock from anterior STEMI", "Cardiac", S, "adult elderly", ["cold, gray, hypotensive with chest pressure"], ["septic_shock_nh", "massive_pe", "aortic_dissection"]);
  E("massive_pe", "Massive pulmonary embolism (obstructive shock)", "Resuscitation", S, "adult elderly", ["post-op day 6", "syncope then hypoxia", "on estrogen, called anxious"], ["panic_attack", "cardiogenic_shock_stemi", "tension_ptx"]);
  E("tension_ptx", "Tension pneumothorax", "Resuscitation", S, "adolescent adult elderly", ["after blunt chest trauma", "COPD patient getting worse on BiPAP"], ["spont_ptx_small", "massive_pe", "copd_bipap"]);
  E("ugib_shock", "Upper GI bleed with hemorrhagic shock", "Resuscitation", S, "adult elderly", ["coffee-ground emesis", "melena and syncope", "variceal bleed in heavy drinker"], ["gastroenteritis", "vasovagal_syncope", "gi_bleed_anticoag"]);
  E("ectopic_ruptured", "Ruptured ectopic pregnancy", "OB", S, "adolescent adult", ["syncope at work", "shoulder-tip pain", "'just a late period'"], ["cystitis", "renal_colic", "vasovagal_syncope", "appendicitis"], { sex: "F", ageRange: [15, 44] });
  E("post_arrest", "Post-cardiac-arrest care after ROSC", "Resuscitation", S, "adult elderly", ["witnessed VF arrest, ROSC with EMS"], ["opioid_od", "hyperkalemia_dialysis", "stemi_lytics"]);

  // Serious — airway (v2)
  E("angioedema_ace", "ACE-inhibitor angioedema", "Airway", S, "adult elderly", ["lip swelling on lisinopril", "tongue swelling with voice change"], ["urticaria", "anaphylaxis", "ludwig_angina"]);
  E("epiglottitis_adult", "Adult epiglottitis", "Airway", S, "adult", ["severe sore throat with a normal-looking pharynx"], ["viral_pharyngitis", "pta", "strep_pharyngitis"]);
  E("ich_spontaneous", "Spontaneous intracerebral hemorrhage with falling GCS", "Airway", S, "adult elderly", ["hypertensive, vomiting, getting sleepier"], ["stroke_tnk", "hypoglycemia_insulin", "etoh_intox"]);
  E("difficult_airway_obese", "Hypercapnic respiratory failure with anticipated difficult airway", "Airway", S, "adult", ["morbid obesity, beard, somnolent"], ["copd_bipap", "opioid_od", "chf_scape"]);
  E("ludwig_angina", "Ludwig's angina (impending airway obstruction)", "Airway", S, "adult", ["toothache then floor-of-mouth swelling", "drooling and trismus"], ["dental_pain", "pta", "angioedema_ace"]);

  // Serious — trauma (v2)
  E("pto_entanglement", "PTO entanglement with upper-extremity injury and hemorrhage", "Trauma", S, "adolescent adult elderly", ["arm caught in a power take-off shaft"], ["auger_amputation", "crush_tractor"], { sex: "M" });
  E("auger_amputation", "Grain auger traumatic amputation", "Trauma", S, "adolescent adult", ["foot in an auger", "hand in an auger"], ["pto_entanglement", "laceration"], { sex: "M" });
  E("crush_tractor", "Tractor rollover crush injury", "Trauma", S, "adult elderly", ["pinned for two hours before found"], ["pelvic_fx_mtp", "pto_entanglement"], { sex: "M" });
  E("stab_chest", "Stab wound to chest with hemothorax", "Trauma", S, "adolescent adult", ["stab to left chest, talking", "bar fight, 'just a scratch'"], ["tension_ptx", "tamponade"]);
  E("gsw_abdomen", "Gunshot wound to abdomen", "Trauma", S, "adolescent adult", ["hunting accident"], ["stab_chest", "blunt_mvc_spleen"]);
  E("blunt_mvc_spleen", "Blunt MVC with occult splenic injury", "POCUS", S, "adolescent adult", ["seatbelt sign, 'fine' at the scene", "left shoulder pain after a rollover"], ["contusion", "costochondritis", "pelvic_fx_mtp"]);
  E("elderly_sdh", "Delayed subdural hematoma after fall on anticoagulation", "Trauma", S, "elderly nh", ["normal at first, worse six hours later"], ["nh_fall_nofx", "nh_uti_ams", "stroke_tnk"]);
  E("pelvic_fx_mtp", "Pelvic fracture with massive hemorrhage", "Trauma", S, "adult elderly", ["thrown from a horse", "rollover MVC"], ["blunt_mvc_spleen", "hip_fracture"]);
  E("epidural_hematoma", "Epidural hematoma with lucid interval", "Trauma", S, "adolescent adult", ["baseball to the temple, lucid then down"], ["etoh_intox", "minor_head_injury", "tension_headache"]);
  E("hip_fracture", "Hip fracture", "Trauma", S, "elderly nh", ["shortened, externally rotated leg"], ["nh_fall_nofx", "pelvic_fx_mtp"], { cantMiss: false });

  // Serious — OB (v2)
  E("precipitous_delivery", "Precipitous delivery in the ED", "OB", S, "adolescent adult", ["unknown pregnancy", "no prenatal care, crowning in triage"], ["shoulder_dystocia", "constipation"], { sex: "F", ageRange: [15, 44] });
  E("shoulder_dystocia", "Shoulder dystocia", "OB", S, "adult", ["obese, diabetic mother"], ["precipitous_delivery", "pph"], { sex: "F", ageRange: [18, 44] });
  E("pph", "Postpartum hemorrhage", "OB", S, "adolescent adult", ["home birth, boggy uterus"], ["precipitous_delivery", "ugib_shock"], { sex: "F", ageRange: [16, 44] });
  E("eclampsia", "Eclampsia", "OB", S, "adolescent adult", ["seizure at 34 weeks", "postpartum day 5 headache and seizure"], ["migraine", "stroke_tnk", "hyponatremia_seizure"], { sex: "F", ageRange: [15, 44] });
  E("severe_preeclampsia", "Preeclampsia with severe features", "OB", S, "adult", ["headache and RUQ pain at 36 weeks"], ["migraine", "biliary_colic", "gerd"], { sex: "F", ageRange: [18, 44] });
  E("neonatal_resus", "Newborn needing resuscitation (NRP)", "OB", S, "infant", ["born in the car, limp and apneic"], ["precipitous_delivery"], { ageRange: [0, 0] });

  // Serious — pediatrics (v2)
  E("rsv_apnea", "RSV bronchiolitis with apnea", "Pediatrics", S, "infant", ["8-week-old with pauses in breathing"], ["bronchiolitis_mild", "infant_feeding", "nat"], { ageRange: [0.05, 0.4] });
  E("fb_aspiration", "Foreign body aspiration", "Pediatrics", S, "child", ["choked on a peanut, now wheezing"], ["asthma_mild", "croup_mild"], { ageRange: [1, 4] });
  E("status_asthmaticus", "Status asthmaticus", "Ventilation", S, "child adolescent adult", ["silent chest", "tired teenager who stopped talking"], ["asthma_mild", "fb_aspiration", "anaphylaxis"]);
  E("epiglottitis_child", "Epiglottitis (unvaccinated child)", "Pediatrics", S, "child", ["drooling, tripoding, quiet"], ["croup_mild", "strep_pharyngitis", "fb_aspiration"]);
  E("peds_septic_shock", "Pediatric septic shock", "Pediatrics", S, "infant child", ["warm shock, mottled legs", "lethargic toddler with petechiae"], ["viral_fever_toddler", "infant_gastro"]);
  E("status_epilepticus_peds", "New-onset seizure / status epilepticus", "Pediatrics", S, "infant child adolescent", ["still seizing on arrival"], ["febrile_seizure", "hypoglycemia_insulin", "bacterial_meningitis", "nat"]);
  E("peds_dka", "DKA in new-onset type 1 diabetes", "Pediatrics", S, "child adolescent", ["vomiting called a stomach bug", "weight loss and bedwetting"], ["infant_gastro", "gastroenteritis", "appendicitis"]);
  E("nat", "Non-accidental trauma", "Pediatrics", S, "infant child", ["story doesn't fit the injury", "sentinel bruise on a pre-mobile infant"], ["minor_head_injury", "infant_feeding", "burn_simple"]);
  E("intussusception", "Intussusception", "Pediatrics", S, "infant child", ["intermittent screaming then lethargy"], ["infant_gastro", "constipation"], { ageRange: [0.3, 3] });
  E("appendicitis", "Appendicitis", "Medical", S, "child adolescent adult elderly", ["periumbilical pain migrating right", "elderly with vague pain"], ["gastroenteritis", "constipation", "ectopic_ruptured"]);

  // Serious — cardiac (v2)
  E("stemi_lytics", "STEMI — lytics decision without a cath lab", "Cardiac", S, "adult elderly", ["classic crushing pain", "diabetic with only dyspnea", "epigastric pain called indigestion", "inferior STEMI with bradycardia"], ["gerd", "costochondritis", "aortic_dissection", "panic_attack"]);
  E("afib_rvr", "Atrial fibrillation with RVR and hypotension", "Cardiac", S, "adult elderly", ["hypotensive and short of breath", "rate driven by sepsis"], ["svt", "septic_shock_nh"]);
  E("vtach", "Ventricular tachycardia", "Cardiac", S, "adult elderly", ["stable wide-complex tachycardia", "VT with a pulse and hypotension"], ["svt", "hyperkalemia_dialysis"]);
  E("svt", "Supraventricular tachycardia", "Cardiac", S, "child adolescent adult", ["sudden palpitations"], ["panic_attack", "afib_rvr"], { cantMiss: false });
  E("complete_heart_block", "Complete heart block needing pacing", "Cardiac", S, "adult elderly nh", ["syncope at the grocery store", "dizzy and gray"], ["med_side_effect", "vasovagal_syncope", "hyperkalemia_dialysis"]);
  E("nstemi", "NSTEMI", "Cardiac", S, "adult elderly", ["older patient with only fatigue", "diabetic with dyspnea"], ["gerd", "costochondritis", "panic_attack"]);

  // Serious — most-missed mimics (v2)
  E("aortic_dissection", "Aortic dissection", "Cardiac", S, "adult elderly", ["presenting as MI", "presenting as stroke", "presenting as back pain"], ["stemi_lytics", "back_pain_mech", "stroke_tnk"]);
  E("sah", "Subarachnoid hemorrhage", "Neuro", S, "adult", ["headache that's 'better now'", "neck pain after exertion"], ["migraine", "tension_headache"]);
  E("bacterial_meningitis", "Bacterial meningitis", "Neuro", S, "infant child adolescent adult elderly", ["looks like flu", "college student home for break"], ["viral_fever_toddler", "migraine", "uri"]);
  E("mesenteric_ischemia", "Mesenteric ischemia", "Medical", S, "elderly nh", ["pain out of proportion, in atrial fibrillation"], ["gastroenteritis", "constipation", "fecal_impaction"]);
  E("cauda_equina", "Cauda equina syndrome", "Neuro", S, "adult", ["back pain with subtle retention"], ["back_pain_mech", "renal_colic"]);
  E("nec_fasc", "Necrotizing soft-tissue infection", "Medical", S, "adult elderly", ["looked like cellulitis", "diabetic with pain beyond the redness"], ["cellulitis", "contact_derm", "dvt"]);
  E("temporal_arteritis", "Giant cell arteritis", "Neuro", S, "elderly", ["headache with jaw claudication", "transient vision loss"], ["tension_headache", "sinusitis"]);
  E("testicular_torsion", "Testicular torsion", "Medical", S, "child adolescent", ["presenting as abdominal pain", "woke with scrotal pain"], ["gastroenteritis", "renal_colic", "sti_cervicitis"], { sex: "M" });

  // Serious — tox / environmental (v2)
  E("opioid_od", "Opioid overdose", "Tox/Environmental", S, "adolescent adult elderly", ["fentanyl-laced pills", "grandparent's patches"], ["etoh_intox", "hypoglycemia_insulin", "post_arrest"]);
  E("meth_psychosis", "Methamphetamine psychosis with agitation", "Tox/Environmental", S, "adult", ["brought in by deputies, combative"], ["bh_boarding", "alcohol_withdrawal", "heat_stroke"]);
  E("alcohol_withdrawal", "Severe alcohol withdrawal", "Tox/Environmental", S, "adult elderly", ["tremulous on day 2 without a drink", "withdrawal seizure"], ["etoh_intox", "meth_psychosis", "hypoglycemia_insulin"]);
  E("apap_od", "Acetaminophen overdose", "Tox/Environmental", S, "adolescent adult", ["asymptomatic after a breakup", "staggered ingestion for back pain"], ["gastroenteritis", "etoh_intox"]);
  E("snakebite", "Rattlesnake envenomation", "Tox/Environmental", S, "child adolescent adult", ["bitten while moving hay bales"], ["cellulitis", "bee_sting_local"]);
  E("hypothermia", "Accidental hypothermia", "Tox/Environmental", S, "adult elderly", ["found outside in January"], ["etoh_intox", "septic_shock_nh"]);
  E("heat_stroke", "Exertional heat stroke", "Tox/Environmental", S, "adolescent adult", ["baling hay in July", "football practice"], ["meth_psychosis", "septic_shock_nh"]);
  E("anaphylaxis", "Anaphylaxis", "Tox/Environmental", S, "child adolescent adult", ["bee sting while mowing", "peanut exposure"], ["urticaria", "bee_sting_local", "asthma_mild", "angioedema_ace"]);
  E("tca_od", "Tricyclic antidepressant overdose", "Tox/Environmental", S, "adolescent adult", ["intentional ingestion, sleepy, wide QRS"], ["opioid_od", "meth_psychosis"]);
  E("organophosphate", "Organophosphate poisoning", "Tox/Environmental", S, "adult", ["crop sprayer with vomiting and wheeze"], ["gastroenteritis", "opioid_od", "status_asthmaticus"]);
  E("co_poisoning", "Carbon monoxide poisoning", "Tox/Environmental", S, "child adult elderly", ["whole family with headaches", "generator in the garage"], ["tension_headache", "gastroenteritis", "uri"]);
  E("salicylate_od", "Salicylate toxicity", "Ventilation", S, "adolescent adult", ["tinnitus and fast breathing"], ["dka_adult", "panic_attack", "apap_od"]);

  // Serious — new in v3
  E("stroke_tnk", "Acute ischemic stroke — telestroke tenecteplase decision", "Neuro", S, "adult elderly", ["last known well 90 minutes ago", "wake-up stroke", "aphasia mistaken for confusion"], ["hypoglycemia_insulin", "migraine", "ich_spontaneous", "bppv"]);
  E("stroke_posterior", "Posterior circulation stroke presenting as vertigo", "Neuro", S, "adult elderly", ["dizziness and vomiting", "can't walk straight"], ["bppv", "gastroenteritis"]);
  E("bh_boarding", "Behavioral health crisis — suicidal, boarding with no psych bed", "Medical", S, "adolescent adult", ["suicidal after an arrest", "teen with a plan"], ["apap_od", "meth_psychosis"]);
  E("hyperkalemia_dialysis", "Hyperkalemia — dialysis patient who missed a session", "Medical", S, "adult elderly", ["weak after missing Friday dialysis", "bradycardic and lightheaded"], ["complete_heart_block", "deconditioning", "chf_scape"]);
  E("dka_adult", "Adult diabetic ketoacidosis", "Medical", S, "adolescent adult", ["ran out of insulin, vomiting", "euglycemic DKA on an SGLT2 inhibitor"], ["gastroenteritis", "appendicitis", "panic_attack"]);
  E("copd_bipap", "COPD exacerbation needing BiPAP", "Ventilation", S, "adult elderly", ["sleepy CO2 retainer", "pneumonia trigger"], ["chf_scape", "pneumonia_cap", "bronchitis"]);
  E("chf_scape", "Acute heart failure — sympathetic crashing pulmonary edema", "Ventilation", S, "adult elderly", ["flash pulmonary edema, BP over 200", "drowning at 3 AM"], ["copd_bipap", "pneumonia_cap", "status_asthmaticus"]);
  E("gi_bleed_anticoag", "Anticoagulated GI bleed needing reversal", "Resuscitation", S, "adult elderly nh", ["on warfarin with INR 6", "on apixaban with melena"], ["ugib_shock", "deconditioning", "epistaxis"]);

  // Serious — coverage for POCUS, ventilation, vascular access, transfer
  E("tamponade", "Pericardial tamponade", "POCUS", S, "adult elderly", ["malignant effusion with dyspnea", "after a stab wound"], ["chf_scape", "massive_pe", "tension_ptx"]);
  E("aaa_rupture", "Ruptured abdominal aortic aneurysm", "POCUS", S, "elderly", ["'kidney stone' at 72", "syncope and back pain"], ["renal_colic", "back_pain_mech", "cauda_equina"], { sex: "M" });
  E("ards_pneumonia", "Severe pneumonia with ARDS needing intubation", "Ventilation", S, "adult elderly", ["influenza season", "aspiration after a seizure"], ["pneumonia_cap", "chf_scape", "copd_bipap"]);
  E("peds_shock_io", "Hypovolemic shock in an infant needing IO access", "Vascular access", S, "infant child", ["no IV after three attempts"], ["infant_gastro", "peds_septic_shock"]);
  E("sepsis_no_access", "Septic shock with no peripheral access", "Vascular access", S, "adult", ["injection drug use, no veins", "obese with failed IVs"], ["septic_shock_nh", "cellulitis"]);
  E("hyponatremia_seizure", "Severe hyponatremia with seizure", "Medical", S, "adult elderly", ["beer potomania", "elderly on a new SSRI and thiazide"], ["alcohol_withdrawal", "eclampsia", "nh_dehydration"]);
  E("sbo", "Small bowel obstruction", "Medical", S, "adult elderly nh", ["prior surgery, bilious vomiting"], ["constipation", "gastroenteritis", "fecal_impaction"]);
  E("pe_stable", "Pulmonary embolism, hemodynamically stable", "Medical", S, "adult", ["pleuritic pain on estrogen (contraceptive or hormone therapy)", "dyspnea two weeks after knee surgery", "postpartum dyspnea"], ["panic_attack", "pneumonia_cap", "costochondritis"]);
  E("tbi_transfer", "Severe TBI — intubate and package for neurosurgical transfer", "Transfer", S, "adolescent adult elderly", ["ATV rollover, GCS 7"], ["etoh_intox", "epidural_hematoma"]);
  E("burn_major", "Major burn needing burn-center transfer", "Transfer", S, "child adult", ["barn fire", "gasoline flash burn"], ["burn_simple", "co_poisoning"]);
  E("stemi_failed_lysis", "STEMI after lytics without reperfusion — rescue PCI transfer", "Transfer", S, "adult elderly", ["persistent ST elevation 90 minutes after tenecteplase"], ["stemi_lytics", "aortic_dissection"]);

  var BY_ID = {};
  for (var ci = 0; ci < CATALOG.length; ci++) BY_ID[CATALOG[ci].id] = CATALOG[ci];

  // ── Conditions roll ───────────────────────────────────────────────────────
  function isNight(hour) { return hour >= 19 || hour < 7; }
  // hostile (Drill): more nights, CT down more often, the helicopter grounded more often, diversion more often.
  function rollConditions(rng, hostile) {
    rng = rng || Math.random;
    var hour;
    if (rng() < (hostile ? 0.7 : 0.4)) hour = (19 + Math.floor(rng() * 12)) % 24; // 19..06
    else hour = 7 + Math.floor(rng() * 12); // 07..18
    var minute = Math.floor(rng() * 60);
    var inHours = hour >= FACILITY.ctHours[0] && hour < FACILITY.ctHours[1];
    var ctAvailable = inHours ? true : rng() < (hostile ? 0.1 : 0.25); // night: CT tech in house
    var ctOnCall = ctAvailable ? false : rng() < 0.75; // A10: otherwise ~75% a tech can be called back
    var fr = rng();
    var flight = fr < (hostile ? 0.45 : 0.65) ? "available" : fr < 0.85 ? "weather" : "in use";
    return {
      hour: hour,
      minute: minute,
      ctAvailable: ctAvailable,
      ctOnCall: ctOnCall,
      flight: flight,
      groundEta: rint(rng, 60, 90),
      obNegUnits: rint(rng, 0, 4),
      tertiaryDiversion: rng() < (hostile ? 0.2 : 0.1),
      nurseCount: rng() < 0.5 ? 1 : 2
    };
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  // Short strip for the doorway screen. Diversion is not shown: it surfaces on the first call.
  function conditionsLabel(c) {
    if (!c) return "";
    var parts = [pad2(c.hour) + ":" + pad2(c.minute || 0)];
    parts.push(c.ctAvailable ? "CT up" : c.ctOnCall ? "CT tech on call" : "CT down");
    parts.push(c.flight === "available" ? "Flight available" : c.flight === "weather" ? "Flight weathered out" : "Flight in use");
    parts.push("Ground " + c.groundEta + " min");
    parts.push(c.obNegUnits + (c.obNegUnits === 1 ? " unit" : " units") + " O-neg");
    parts.push(c.nurseCount + (c.nurseCount === 1 ? " nurse" : " nurses"));
    return parts.join(" · ");
  }

  // ── Demographics ──────────────────────────────────────────────────────────
  function rollAgeBand(rng, entry, avoid) {
    var bands = entry.ages.filter(function (b) { return AGE_BANDS[b]; });
    if (avoid && bands.length > 1) bands = bands.filter(function (b) { return b !== avoid; });
    if (!bands.length) bands = ["adult"];
    return pickWeighted(rng, bands, function (b) { return AGE_BANDS[b].weight; });
  }
  function rollAge(rng, entry, band) {
    var ab = AGE_BANDS[band];
    var lo = ab.min, hi = ab.max;
    if (entry.ageRange) {
      var nlo = Math.max(lo, entry.ageRange[0]), nhi = Math.min(hi, entry.ageRange[1]);
      if (nlo <= nhi) { lo = nlo; hi = nhi; }
      else { lo = entry.ageRange[0]; hi = entry.ageRange[1]; }
    }
    if (band === "infant") return Math.round((lo + rng() * (hi - lo)) * 100) / 100;
    return rint(rng, Math.ceil(lo), Math.floor(hi));
  }
  function rollDemo(rng, entry, band) {
    var eth = pickWeighted(rng, ETHNICITIES, function (e) { return e.weight; });
    var fitz = rint(rng, eth.fitz[0], eth.fitz[1]);
    var sex = entry.sex || (rng() < 0.5 ? "M" : "F");
    var age = rollAge(rng, entry, band);
    return { age: age, sex: sex, ethnicity: eth.name, fitz: fitz };
  }
  function ageLabel(age) {
    if (age < 1) {
      var mo = Math.round(age * 12);
      if (mo < 1) { var d = Math.max(0, Math.round(age * 365)); return d === 0 ? "newborn" : d + " d"; }
      return mo + " mo";
    }
    return age + " y";
  }

  // ── Selection ─────────────────────────────────────────────────────────────
  function domainWeight(byDomain, domain) {
    var d = byDomain && byDomain[domain];
    var avg = d && d.n >= 3 ? d.avg : 60;
    return clamp(1 + (70 - avg) / 50, 0.5, 2.5);
  }
  function recentDxIds(history, n) {
    var out = {};
    var h = (history || []).slice(-n);
    for (var i = 0; i < h.length; i++) if (h[i] && h[i].dxId) out[h[i].dxId] = true;
    return out;
  }
  function dueMissItem(missQueue, now) {
    var best = null;
    (missQueue || []).forEach(function (m) {
      if (!m || !m.due || m.stage >= m.due.length || !BY_ID[m.dxId]) return;
      var d = m.due[m.stage];
      if (d <= now && (!best || d < best.due[best.stage])) best = m;
    });
    return best;
  }

  // stats: DW.stats() shape (history, byDomain, missQueue). opts: {mode, seed, now}
  function pickCase(stats, opts) {
    stats = stats || {};
    opts = opts || {};
    var seedNum = opts.seed !== undefined && opts.seed !== null ? opts.seed >>> 0 : (Date.now() >>> 0);
    var rng = mulberry32(seedNum);
    var now = opts.now || Date.now();
    var mode = opts.mode === "drill" ? "drill" : "shift";
    var history = stats.history || [];
    var conditions = rollConditions(rng, mode === "drill");

    var entry = null, presentation = null, band = null, reexposure = null;

    // (1) a due miss-queue item comes back as a re-exposure, with a different presentation and age
    // band, on roughly one pick in three once due, so "due" never predicts the next patient.
    var due = dueMissItem(stats.missQueue, now);
    var reexposeChance = opts.reexposeChance === undefined ? 1 / 3 : opts.reexposeChance;
    if (due && rng() < reexposeChance) {
      entry = BY_ID[due.dxId];
      var pres = entry.presentations.filter(function (p) { return p !== due.presentation; });
      presentation = pickOne(rng, pres.length ? pres : entry.presentations);
      band = rollAgeBand(rng, entry, due.ageBand);
      reexposure = { originalCaseId: due.originalCaseId, originalPresentation: due.presentation, originalAgeBand: due.ageBand, dxId: due.dxId };
    }

    var recent = recentDxIds(history, 10);

    // (4) interleave: after a serious case, one of its lookalikes 30% of the time (always in Drill)
    if (!entry) {
      var last = history.length ? history[history.length - 1] : null;
      var lastEntry = last && last.dxId ? BY_ID[last.dxId] : null;
      if (lastEntry && lastEntry.bucket === "serious" && rng() < (mode === "drill" ? 1 : 0.3)) {
        var looks = lastEntry.lookalikes.filter(function (id) { return BY_ID[id] && !recent[id]; });
        if (looks.length) entry = BY_ID[pickOne(rng, looks)];
      }
    }

    // (2) bucket roll, (3) domain-weighted pick within bucket
    if (!entry) {
      var pSerious = mode === "drill" ? 0.7 : 0.25;
      var bucket = rng() < pSerious ? "serious" : "benign";
      var pool = CATALOG.filter(function (e) { return e.bucket === bucket && !recent[e.id]; });
      if (!pool.length) pool = CATALOG.filter(function (e) { return e.bucket === bucket; });
      entry = pickWeighted(rng, pool, function (e) { return domainWeight(stats.byDomain, e.domain); });
    }

    if (!presentation) presentation = pickOne(rng, entry.presentations);
    if (!band) band = rollAgeBand(rng, entry, null);
    var demo = rollDemo(rng, entry, band);

    var transferTwist = null;
    if (entry.bucket === "serious") {
      if (conditions.tertiaryDiversion) transferTwist = "declined";
      else if (rng() < 0.07) transferTwist = "refuses";
    }

    return {
      caseId: "c" + seedNum.toString(36) + "-" + Math.floor(rng() * 1e8).toString(36),
      dxId: entry.id,
      dx: entry.dx,
      domain: entry.domain,
      bucket: entry.bucket,
      cantMiss: entry.cantMiss,
      presentation: presentation,
      ageBand: band,
      age: demo.age,
      ageLabel: ageLabel(demo.age),
      sex: demo.sex,
      ethnicity: demo.ethnicity,
      fitz: demo.fitz,
      conditions: conditions,
      mode: mode,
      seed: seedNum,
      reexposure: reexposure,
      transferTwist: transferTwist
    };
  }

  root.DW_CASES = {
    FACILITY: FACILITY,
    DOMAINS: DOMAINS,
    CATALOG: CATALOG,
    AGE_BANDS: AGE_BANDS,
    BAND_ORDER: BAND_ORDER,
    ETHNICITIES: ETHNICITIES,
    byId: function (id) { return BY_ID[id] || null; },
    rollConditions: rollConditions,
    conditionsLabel: conditionsLabel,
    isNight: isNight,
    ageLabel: ageLabel,
    pickCase: pickCase,
    mulberry32: mulberry32
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
