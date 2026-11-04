# MARGIN OS demonstration data

All records in this directory are fictional demonstration data for **The North Star
Kitchen**, an independent North East restaurant in Newcastle upon Tyne. Prices are
in GBP and ingredient quantities use the ingredient's listed purchase unit.

`restaurant.json` is deliberately independent of the backend's existing "Le Petit
Atlas" fixture. The QA tests calculate every expected financial value from this
file rather than copying expected results into the assertions.
