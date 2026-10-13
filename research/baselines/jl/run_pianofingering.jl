# Batch driver for JuliaMusic/PianoFingering.jl (GPL-3.0) on PIG files.
# usage (cwd = work dir that contains pig/<name>.txt and an empty output/ dir):
#   julia --project=<PianoFingering.jl checkout> -t auto run_pianofingering.jl name1 name2 ...
# Writes output/<name>_output.txt (the package's own PIG writer) and appends
# "<name>\t<seconds>\t<status>" lines to timings.tsv.
using PianoFingering
for name in ARGS
    t0 = time()
    status = "ok"
    try
        PianoFingering.fingering("$(name).txt")
    catch err
        status = "error: " * replace(sprint(showerror, err), r"\s+" => " ")
    end
    open("timings.tsv", "a") do io
        println(io, "$(name)\t$(round(time() - t0, digits=3))\t$(status)")
    end
    flush(stdout)
end
