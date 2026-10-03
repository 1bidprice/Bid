# NBG Business Seeds 2026 — MINBEIS Phase A

## Τίτλος
MINBEIS: Ελεγχόμενη επενδυτική νοημοσύνη που μαθαίνει χωρίς hindsight

## Περιγραφή πρότασης

### Σκοπός και χρήση
Το MINBEIS είναι εφαρμογή υποστήριξης επενδυτικών αποφάσεων για ιδιώτες επενδυτές. Συνδυάζει παρακολούθηση χαρτοφυλακίου, έλεγχο ποιότητας δεδομένων, τεκμηριωμένη έρευνα, κανόνες πειθαρχίας και ένα ελεγχόμενο σύστημα μάθησης από προηγούμενες αποφάσεις. Δεν εκτελεί αυτόματα συναλλαγές και δεν υπόσχεται αποδόσεις. Στόχος είναι ο χρήστης να βλέπει όχι μόνο τι κατέχει και τι κερδίζει ή χάνει, αλλά και γιατί πάρθηκε μία απόφαση, ποια δεδομένα ήταν διαθέσιμα τότε και τι συνέβη αργότερα.

### Κοινό-στόχος
Αρχικό κοινό είναι οι αυτοκατευθυνόμενοι retail investors που χρησιμοποιούν μετοχές και ETFs και σήμερα μοιράζουν τη διαδικασία τους μεταξύ broker, portfolio tracker, οικονομικών ειδήσεων, spreadsheets και AI assistants. Ιδιαίτερη αξία έχει για χρήστες που θέλουν να περιορίζουν παρορμητικές αποφάσεις, να ελέγχουν συγκέντρωση και κίνδυνο και να έχουν διαφανές ιστορικό των αποφάσεών τους.

### Λειτουργία και βασικά χαρακτηριστικά
Η Android εφαρμογή καταγράφει συναλλαγές και υπολογίζει αξία θέσης, κόστος, κέρδος/ζημία, κατανομή και συνεισφορά κάθε θέσης στο αποτέλεσμα. Υποστηρίζει ΗΠΑ και Euronext Athens με fail-closed κανόνες: όταν η τιμή, η ταυτότητα του τίτλου ή άλλο κρίσιμο δεδομένο δεν είναι επαρκώς επαληθευμένο, το σύστημα δεν κατασκευάζει τιμή ή συμπέρασμα. Το MINBEIS διαθέτει research dossiers, opportunity analysis, data-quality/confidence indicators και human approval πριν από οποιαδήποτε επενδυτική ενέργεια.

### Καινοτομία
Η κύρια καινοτομία είναι ο governed learning κύκλος. Κάθε τελική απόφαση μπορεί να αποθηκεύεται σε αμετάβλητο Decision Journal με timestamp, reference price, action, confidence, blockers, policy version και hash του context. Έπειτα το Outcome Engine αξιολογεί τι συνέβη μετά από 7, 30 και 90 trading days, μαζί με benchmark/excess return και maximum favorable/adverse excursion.

Για ιστορική έρευνα, το point-in-time replay επιτρέπει στο σύστημα να «ξαναζεί» μια παλιά ημερομηνία χρησιμοποιώντας μόνο στοιχεία που είχαν δημοσιευθεί έως τότε. Ειδήσεις ή evidence μετά το as-of αποκλείονται, undated evidence μπλοκάρεται και future candles δεν μπαίνουν στο decision input. Έτσι αποφεύγεται το look-ahead bias.

Όταν επαρκές prospective evidence δείχνει ότι ένα συγκεκριμένο context ήταν αδύναμο, το MINBEIS μπορεί να δημιουργήσει frozen Learning Proposal, π.χ. η αγορά σε συγκεκριμένο market regime να μετατραπεί σε WATCH σε shadow mode. Η πρόταση δεν εφαρμόζεται. Ελέγχεται μόνο πάνω σε νέες αποφάσεις που συνέβησαν μετά τη δημιουργία της. Για να γίνει promotion candidate πρέπει να περάσει όρια sample size, διαφορετικών ημερομηνιών και τίτλων, μέσης υπεροχής, win rate και σταθερότητας σε διαδοχικές χρονικές περιόδους. Ακόμη και τότε απαιτείται ρητή ανθρώπινη έγκριση και πλήρες regression testing.

### Ανταγωνισμός και διαφοροποίηση
Υπάρχουν broker apps, portfolio trackers, stock screeners, robo-advisors και γενικοί AI assistants. Η διαφοροποίηση του MINBEIS δεν είναι ότι «προβλέπει καλύτερα τη μετοχή». Είναι ότι ενώνει portfolio, research, decision journal, outcome measurement, point-in-time replay και governed model improvement σε μία ελέγξιμη αλυσίδα. Το σύστημα διατηρεί σαφή διαχωρισμό μεταξύ research, decision support και execution.

### Τεχνικά χαρακτηριστικά και υποδομή
Το προϊόν διαθέτει Android client, canonical accounting engine, market-data gateway, research/intelligence pipeline, historical/event archives, CI regression suites και sidecar learning datasets. Τα προσωπικά στοιχεία χαρτοφυλακίου παραμένουν τοπικά στην εγκατάσταση. Υπάρχει installation ownership isolation, quarantine/recovery για legacy δεδομένα και απενεργοποιημένο Android backup ώστε να αποφεύγεται ακούσια μεταφορά χαρτοφυλακίου. Τα quote requests δεν στέλνουν ποσότητες, cost basis, P/L ή σημειώσεις χαρτοφυλακίου.

### Ωριμότητα και εφικτότητα
Υπάρχει λειτουργικό Android MVP, πραγματικό portfolio workflow και αυτοματοποιημένα tests για accounting, data integrity, privacy, market routing και learning governance. Η έκδοση MINBEIS v1.8.3 build 35 έχει περάσει έξι CI pipelines στο τεχνικό checkpoint του funding-readiness build. Παραμένουν πριν από δημόσιο production launch: production signing/Play testing, δεύτερο-device privacy QA, αδειοδοτημένη στρατηγική historical market data, εξωτερικό beta και νομικός/κανονιστικός έλεγχος.

### Οφέλη
Για τον χρήστη, το άμεσο όφελος είναι καλύτερη πειθαρχία, διαφάνεια και κατανόηση του «γιατί» πίσω από μία επενδυτική απόφαση. Για το fintech οικοσύστημα, το MINBEIS προτείνει μία ελέγξιμη προσέγγιση AI όπου η μάθηση δεν βασίζεται σε hindsight και καμία αλλαγή παραγωγής δεν εφαρμόζεται αυτόματα. Η χρηματοδότηση θα χρησιμοποιηθεί κυρίως για licensed data, external beta, security/privacy και regulatory review, production distribution, UX/onboarding και prospective model validation.

## Submission checks
- Title: 8 words, below the 20-word limit.
- Proposal body: approximately 631 words, below the 1,000-word Phase A limit.
- No claim of guaranteed returns, proven alpha or autonomous trading.
- Legal/team personal fields intentionally excluded until verified by the applicant.
